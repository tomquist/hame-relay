import {createHash} from 'crypto';
import fetch from 'node-fetch';
import {logger} from './logger';

export interface HameApiResponse {
  code: string;
  msg: string;
  token?: string;
  data: Array<{
    devid: string;
    name: string;
    sn: string | null;
    mac: string;
    type: string;
    access: string;
    bluetooth_name: string;
  }> | string;
}

export interface HameDeviceListResponse {
  code: number;
  msg: string;
  data: Array<{
    devid: string;
    name: string;
    mac: string;
    type: string;
    version: string;
  }>;
}

export interface DeviceInfo {
  devid: string;
  name: string;
  mac: string;
  type: string;
  version: string;
}

export class HameApi {
  constructor(private readonly baseUrl: string = 'https://eu.hamedata.com') {}

  private get headers() {
    return {
      'User-Agent': 'Dart/2.19 (dart:io)',
    } as Record<string, string>;
  }

  async fetchDeviceToken(mailbox: string, password: string): Promise<HameApiResponse> {
    const hashedPassword = createHash('md5').update(password).digest('hex');
    const url = new URL('/app/Solar/v2_get_device.php', this.baseUrl);
    url.searchParams.append('mailbox', mailbox);
    url.searchParams.append('pwd', hashedPassword);

    logger.info(`Fetching device token for ${mailbox}...`);
    const resp = await fetch(url.toString(), { headers: this.headers });
    const data: HameApiResponse = await resp.json();

    if (data.code !== '2' || !data.token) {
      throw new Error(`Unexpected API response code: ${data.code} - ${data.msg}`);
    }

    return data;
  }

  async fetchDeviceList(mailbox: string, token: string): Promise<HameDeviceListResponse> {
    const url = new URL('/ems/api/v1/getDeviceList', this.baseUrl.replace(/\/$/, ''));
    url.searchParams.append('mailbox', mailbox);
    url.searchParams.append('token', token);

    logger.info('Fetching device list...');
    const resp = await fetch(url.toString(), { headers: this.headers });
    const data: HameDeviceListResponse = await resp.json();

    if (data.code !== 1) {
      throw new Error(`Unexpected API response from device list: ${data.code} - ${data.msg}`);
    }

    return data;
  }

  async fetchDevices(mailbox: string, password: string): Promise<DeviceInfo[]> {
    const tokenResp = await this.fetchDeviceToken(mailbox, password);
    const list = await this.fetchDeviceList(mailbox, tokenResp.token!);
    return list.data;
  }
}
