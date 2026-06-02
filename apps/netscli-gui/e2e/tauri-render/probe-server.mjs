import http from 'node:http';

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function startProbeServer() {
  const preferredPorts = (process.env.TAURI_RENDER_PORTS ?? '8080,8000,8008,8081,8888,9000')
    .split(',')
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);

  for (const port of preferredPorts) {
    const server = http.createServer((request, response) => {
      response.writeHead(200, {
        Connection: 'close',
        'Content-Type': 'text/plain',
        Server: 'netscli-e2e',
      });
      if (request.method === 'HEAD') {
        response.end();
      } else {
        response.end('netscli-e2e\n');
      }
    });

    try {
      await listen(server, port);
      return { server, port };
    } catch (error) {
      server.close();
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }

  throw new Error(`No HTTP probe port was available from ${preferredPorts.join(', ')}`);
}

export async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}
