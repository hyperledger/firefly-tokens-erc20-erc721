import * as fs from 'fs';
import * as https from 'https';
import { NestApplicationOptions } from '@nestjs/common';
import { AxiosRequestConfig } from 'axios';

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
