import axios from "axios";
import { parseCurlCommand } from '../../src/lib/curlconverter.js';

function convertCurlToAxios(curlCommand) {
  const axiosConfig = parseCurlCommand(curlCommand);
  axiosConfig.validateStatus = null
  return axiosConfig;
}

export async function curlProxy(ctx) {
  const queryData = Object.assign({}, ctx.request.body, ctx.query);
  const { curl } = queryData;

  let axiosConfig = null;
  try {
    axiosConfig = convertCurlToAxios(curl);
    const res = await axios(axiosConfig);
    ctx.body = res.data;
  } catch (err) {
    ctx.status = 500;
    ctx.type = 'application/json';
    ctx.body = {
      code: 500,
      message: err.message,
      axiosConfig,
    };
  }
}
