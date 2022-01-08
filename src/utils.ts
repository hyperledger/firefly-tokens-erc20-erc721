import { AxiosRequestConfig } from 'axios';

export const basicAuth = (username: string, password: string) => {
  const requestOptions: AxiosRequestConfig = {};
  if (username !== '' && password !== '') {
    requestOptions.auth = {
      username: username,
      password: password,
    };
  }
  return requestOptions;
};
