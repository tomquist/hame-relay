// Test environment for hame-relay memory measurements. Runs in its own process
// so that none of its memory is attributed to the relay.
//
//  - Fake Hame cloud API on https://eu.hamedata.com:443 (mapped to 127.0.0.1)
//  - Local (Home Assistant) MQTT broker on mqtt://localhost:1883
//  - Two fake cloud MQTT brokers (mutual TLS) on 8883 (hame-2024) / 8884 (hame-2025)
//  - Simulated apps and devices on both sides, driven by what the relay
//    subscribes to, so both forwarding directions carry traffic
//
// Env: DEVICES (count), POLL_MS (per-device poll interval), OUTAGE_AT_S /
// OUTAGE_FOR_S (cut the relay off from the cloud brokers for a while).
import { readFileSync, writeFileSync } from "fs";
import https from "https";
import net from "net";
import tls from "tls";
import aedesFactory from "aedes";
import mqtt from "mqtt";

const dir = new URL(".", import.meta.url).pathname;
const cert = (f) => readFileSync(`${dir}work/certs/${f}`);
const DEVICES = Number(process.env.DEVICES ?? 6);
const POLL_MS = Number(process.env.POLL_MS ?? 1000);
const OUTAGE_AT_S = Number(process.env.OUTAGE_AT_S ?? 0);
const OUTAGE_FOR_S = Number(process.env.OUTAGE_FOR_S ?? 0);

// A mix of types/firmwares that lands devices on both cloud brokers.
const TEMPLATES = [
  { type: "HMA-1", version: "220" },
  { type: "HMA-1", version: "230" },
  { type: "VNSE3-0", version: "150" },
  { type: "HMJ-1", version: "108" },
  { type: "HMI-1", version: "130" },
  { type: "HME-4", version: "120" },
];
const devices = Array.from({ length: DEVICES }, (_, i) => {
  const t = TEMPLATES[i % TEMPLATES.length];
  const mac = (0xa0b1c2d30000 + i).toString(16).padStart(12, "0");
  return {
    devid: `dev${String(i).padStart(19, "0")}`,
    name: `Device ${i}`,
    sn: null,
    mac,
    type: t.type,
    version: t.version,
    access: "1",
    bluetooth_name: `HM_${mac}`,
  };
});
writeFileSync(`${dir}work/devices.json`, JSON.stringify(devices, null, 2));

// --- Fake cloud API -------------------------------------------------------
https
  .createServer({ key: cert("server.key"), cert: cert("server.crt") }, (req, res) => {
    const url = new URL(req.url, "https://eu.hamedata.com");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/app/Solar/v2_get_device.php") {
      res.end(JSON.stringify({ code: "2", msg: "ok", token: "tok", data: devices }));
    } else if (url.pathname === "/ems/api/v1/getDeviceList") {
      res.end(JSON.stringify({ code: 1, msg: "ok", data: devices }));
    } else if (url.pathname === "/ems/api/v1/getDeviceMqttStatus") {
      res.end(JSON.stringify({ code: 1, msg: "ok", data: { mqtt: 1, ms: 0, datetime: "x" } }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  })
  .listen(443, "127.0.0.1");

// --- Brokers --------------------------------------------------------------
async function broker(port, secure) {
  const aedes = aedesFactory();
  const server = secure
    ? tls.createServer(
        {
          key: cert("server.key"),
          cert: cert("server.crt"),
          ca: cert("ca.crt"),
          requestCert: true,
          rejectUnauthorized: true,
        },
        aedes.handle,
      )
    : net.createServer(aedes.handle);
  // Outages cut off the relay only (client ids hm_/mst_): the simulated
  // devices stay subscribed, so whatever the relay delivers after it
  // reconnects is observable, independent of who reconnects first.
  let refusing = false;
  aedes.preConnect = (client, packet, done) => {
    const isRelay = /^(hm|mst)_/.test(packet.clientId ?? "");
    done(null, !(refusing && isRelay));
    if (refusing && isRelay) client.conn.destroy();
  };
  const listen = () => new Promise((r) => server.listen(port, r));
  await listen();
  return {
    aedes,
    async down() {
      refusing = true;
      for (const c of Object.values(aedes.clients)) {
        if (/^(hm|mst)_/.test(c.id)) c.conn.destroy();
      }
    },
    async up() {
      refusing = false;
    },
  };
}

const local = await broker(1883, false);
const cloud = [await broker(8883, true), await broker(8884, true)];

// Response payload sized like a real B2500 status reply.
const REPLY = Buffer.from(
  "p1=1,p2=1,w1=123,w2=145,pe=87,vv=230,sv=9,cs=0,cd=0,am=0,o1=1,o2=1,do=90,lv=800,cj=2,kn=1840,g1=230,g2=220,b1=1,b2=0,md=0,d1=1,e1=0:0,f1=23:59,h1=800,d2=0,e2=0:0,f2=23:59,h2=0,d3=0,e3=0:0,f3=23:59,h3=0,sg=0,sp=80,st=0,tl=12,th=14,tc=0,tf=0,fc=202310231502,id=5,a0=87,a1=0,a2=0,l0=0,l1=0,c0=255,c1=4,bc=1286,bs=443,pt=1567,it=1009,m0=0,m1=0,m2=0,m3=0,d4=0,e4=0:0,f4=23:59,h4=0,d5=0,e5=0:0,f5=23:59,h5=0,lmo=1840,lmi=1360,lmf=0,uv=107,sm=0,bn=0,ct_t=7,tc_dis=1",
);

// Simulation is driven by what the relay subscribes to:
//  - relay subscribes to an App topic   -> someone on that broker polls it
//  - relay subscribes to a device topic -> a device on that broker answers the
//    matching App topic
// Replies coming back through the relay are counted at the poller.
const counters = { appSent: 0, deviceRecv: 0, cloudAppRecv: 0 };
function simulate(b, url, opts, relayPrefixes, name) {
  const answer = new Set();
  const poll = new Set();
  const c = mqtt.connect(url, { ...opts, clientId: `sim-${name}` });
  c.on("message", (topic) => {
    if (topic.includes("/App/")) {
      counters.cloudAppRecv++;
      c.publish(topic.replace("/App/", "/device/"), REPLY);
    } else {
      counters.deviceRecv++;
    }
  });
  b.aedes.on("subscribe", (subs, client) => {
    if (!relayPrefixes.some((p) => client?.id?.startsWith(p))) return;
    for (const { topic } of subs) {
      if (topic.includes("/device/")) {
        const app = topic.replace("/device/", "/App/");
        if (answer.has(app)) continue;
        answer.add(app);
        c.subscribe(app);
      } else if (!poll.has(topic)) {
        poll.add(topic);
        c.subscribe(topic.replace("/App/", "/device/"));
        setTimeout(() => {
          setInterval(() => {
            if (!c.connected) return;
            counters.appSent++;
            c.publish(topic, "cd=1");
          }, POLL_MS);
        }, Math.random() * POLL_MS);
      }
    }
  });
}
simulate(local, "mqtt://localhost:1883", {}, ["config_"], "local");
cloud.forEach((b, i) =>
  simulate(
    b,
    `mqtts://localhost:${8883 + i}`,
    { ca: cert("ca.crt"), cert: cert("client.crt"), key: cert("client.key") },
    ["hm_", "mst_"],
    `cloud${i}`,
  ),
);

if (OUTAGE_FOR_S > 0) {
  setTimeout(async () => {
    console.log("env: cloud outage begins");
    await Promise.all(cloud.map((c) => c.down()));
    setTimeout(async () => {
      await Promise.all(cloud.map((c) => c.up()));
      console.log("env: cloud outage ends");
    }, OUTAGE_FOR_S * 1000);
  }, OUTAGE_AT_S * 1000);
}

setInterval(() => process.send?.({ counters }), 1000);
process.send?.({ ready: true });
console.log("env: ready");
