import * as fs from 'fs';
import * as https from 'https';
import { NestApplicationOptions } from '@nestjs/common';
import { AxiosRequestConfig } from 'axios';
import { ClientOptions } from 'ws';

interface Certificates {
  key: string;
  cert: string;
  ca: string;
}

const getCertificates = (): Certificates | undefined => {
  let key, cert, ca;
  if (
    process.env['TLS_KEY'] === undefined ||
    process.env['TLS_CERT'] === undefined ||
    process.env['TLS_CA'] === undefined
  ) {
    return undefined;
  }
  try {
    key = fs.readFileSync(process.env['TLS_KEY']).toString();
    cert = fs.readFileSync(process.env['TLS_CERT']).toString();
    ca = fs.readFileSync(process.env['TLS_CA']).toString();
  } catch (error) {
    console.error(`Error reading certificates: ${error}`);
    process.exit(-1);
  }
  return { key, cert, ca };
};

export const getWebsocketOptions = (username: string, password: string): ClientOptions => {
  const requestOptions: ClientOptions = {};
  if (username && username !== '' && password && password !== '') {
    requestOptions.headers = {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    };
  }
  const certs = getCertificates();
  if (certs) {
    requestOptions.ca = certs.ca;
    requestOptions.cert = certs.cert;
    requestOptions.key = certs.key;
  }
  return requestOptions;
};

export const getHttpRequestOptions = (username: string, password: string) => {
  const requestOptions: AxiosRequestConfig = {};
  if (username !== '' && password !== '') {
    requestOptions.auth = {
      username: username,
      password: password,
    };
  }
  const certs = getCertificates();
  if (certs) {
    requestOptions.httpsAgent = new https.Agent({ ...certs, requestCert: true });
  }
  return requestOptions;
};

export const getNestOptions = (): NestApplicationOptions => {
  const options: NestApplicationOptions = {};
  const certs = getCertificates();
  if (certs) {
    options.httpsOptions = certs;
  }
  return options;
};

export const eventStreamName = (topic: string, namespace: string) => {
  return `${topic}/${namespace}`;
};
