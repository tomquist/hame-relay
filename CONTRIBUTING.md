# Contributing

## Development Setup

Prerequisites:
- Node.js 20 or higher
- npm

1. Clone the repository
```bash
git clone https://github.com/tomquist/hame-relay.git
cd hame-relay
```

2. Install dependencies
```bash
npm install
```

3. Build
```bash
npm run build
```

4. Run
```bash
npm start
```

For development with automatic reloading:
```bash
npm run dev
```

## Testing

Run the test suite:
```bash
npm test
```

Run linting:
```bash
npm run lint
```

Fix linting issues automatically:
```bash
npm run lint:fix
```

## Device routing rules

`src/device_matrix.ts` says which broker a device talks to and when its topic id
is encrypted, per device family and firmware version. Those rules mirror the
official app.

[`tools/app-oracle`](tools/app-oracle/README.md) can check them against a
current app build. It is optional maintainer tooling, it is not part of the
relay, and whether you may run it depends on your jurisdiction and the licence
you accepted — read its README first, and the
[interoperability statement](README.md#interoperability-statement). Run it at
your own risk.

## Pull Requests

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please make sure your PR:
- Has a clear description of the changes
- Follows the existing code style
- Includes relevant updates to documentation
- Passes all tests (`npm test`)
- Passes linting checks (`npm run lint`)
