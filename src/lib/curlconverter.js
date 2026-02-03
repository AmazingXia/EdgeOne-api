import querystring from 'querystring';
import URL from 'url';
import yargs from 'yargs';
import cookie from 'cookie';

export const parseCurlCommand = curlCommand => {
  // Remove newlines (and from continuations)
  curlCommand = curlCommand.replace(/\\\r|\\\n/g, '')

  // yargs parses -XPOST as separate arguments. just prescreen for it.
  curlCommand = curlCommand.replace(/ -XPOST/, ' -X POST')
  curlCommand = curlCommand.replace(/ -XGET/, ' -X GET')
  curlCommand = curlCommand.replace(/ -XPUT/, ' -X PUT')
  curlCommand = curlCommand.replace(/ -XPATCH/, ' -X PATCH')
  curlCommand = curlCommand.replace(/ -XDELETE/, ' -X DELETE')
  // Safari adds `-Xnull` if is unable to determine the request type, it can be ignored
  curlCommand = curlCommand.replace(/ -Xnull/, ' ')
  curlCommand = curlCommand.trim()

  // Parse with some understanding of the meanings of flags.  In particular,
  // boolean flags can be trouble if the URL to fetch follows immediately
  // after, since it will be taken as an argument to the flag rather than
  // interpreted as a positional argument.  Someone should add all the flags
  // likely to cause trouble here.
  const parsedArguments = yargs
    .boolean(['I', 'head', 'compressed', 'L', 'k', 'silent', 's'])
    .alias('H', 'header')
    .alias('A', 'user-agent')
    .parse(curlCommand)

  let cookieString
  let cookies
  let url = parsedArguments._[1]

  // if url argument wasn't where we expected it, try to find it in the other arguments
  if (!url) {
    for (const argName in parsedArguments) {
      if (typeof parsedArguments[argName] === 'string') {
        if (parsedArguments[argName].indexOf('http') === 0 || parsedArguments[argName].indexOf('www.') === 0) {
          url = parsedArguments[argName]
        }
      }
    }
  }

  let headers

  if (parsedArguments.header) {
    if (!headers) {
      headers = {}
    }
    if (!Array.isArray(parsedArguments.header)) {
      parsedArguments.header = [parsedArguments.header]
    }
    parsedArguments.header.forEach(header => {
      if (header.indexOf('Cookie') !== -1) {
        cookieString = header
      } else {
        const components = header.split(/:(.*)/)
        headers[components[0]] = components[1].trim()
      }
    })
  }

  if (parsedArguments['user-agent']) {
    if (!headers) {
      headers = {}
    }
    headers['User-Agent'] = parsedArguments['user-agent']
  }

  if (parsedArguments.b) {
    cookieString = parsedArguments.b
  }
  if (parsedArguments.cookie) {
    cookieString = parsedArguments.cookie
  }
  let multipartUploads
  if (parsedArguments.F) {
    multipartUploads = {}
    if (!Array.isArray(parsedArguments.F)) {
      parsedArguments.F = [parsedArguments.F]
    }
    parsedArguments.F.forEach(multipartArgument => {
      // input looks like key=value. value could be json or a file path prepended with an @
      const splitArguments = multipartArgument.split('=', 2)
      const key = splitArguments[0]
      const value = splitArguments[1]
      multipartUploads[key] = value
    })
  }
  if (cookieString) {
    const cookieParseOptions = {
      decode: function (s) { return s }
    }
    // separate out cookie headers into separate data structure
    // note: cookie is case insensitive
    cookies = cookie.parse(cookieString.replace(/^Cookie: /gi, ''), cookieParseOptions)
  }
  let method
  if (parsedArguments.X === 'POST') {
    method = 'post'
  } else if (parsedArguments.X === 'PUT' ||
    parsedArguments.T) {
    method = 'put'
  } else if (parsedArguments.X === 'PATCH') {
    method = 'patch'
  } else if (parsedArguments.X === 'DELETE') {
    method = 'delete'
  } else if (parsedArguments.X === 'OPTIONS') {
    method = 'options'
  } else if ((parsedArguments.d ||
    parsedArguments.data ||
    parsedArguments['data-ascii'] ||
    parsedArguments['data-binary'] ||
    parsedArguments['data-raw'] ||
    parsedArguments.F ||
    parsedArguments.form) && !((parsedArguments.G || parsedArguments.get))) {
    method = 'post'
  } else if (parsedArguments.I ||
    parsedArguments.head) {
    method = 'head'
  } else {
    method = 'get'
  }

  const compressed = !!parsedArguments.compressed
  const urlObject = URL.parse(url); // eslint-disable-line

  // if GET request with data, convert data to query string
  // NB: the -G flag does not change the http verb. It just moves the data into the url.
  if (parsedArguments.G || parsedArguments.get) {
    urlObject.query = urlObject.query ? urlObject.query : ''
    const option = 'd' in parsedArguments ? 'd' : 'data' in parsedArguments ? 'data' : null
    if (option) {
      let urlQueryString = ''

      if (url.indexOf('?') < 0) {
        url += '?'
      } else {
        urlQueryString += '&'
      }

      if (typeof (parsedArguments[option]) === 'object') {
        urlQueryString += parsedArguments[option].join('&')
      } else {
        urlQueryString += parsedArguments[option]
      }
      urlObject.query += urlQueryString
      url += urlQueryString
      delete parsedArguments[option]
    }
  }
  const query = querystring.parse(urlObject.query, null, null, { maxKeys: 10000 })

  urlObject.search = null // Clean out the search/query portion.
  const request = {
    url: url,
    urlWithoutQuery: URL.format(urlObject)
  }
  if (compressed) {
    request.compressed = true
  }

  if (Object.keys(query).length > 0) {
    request.query = query
  }
  if (headers) {
    request.headers = headers
  }
  request.method = method

  if (cookies) {
    request.cookies = cookies
    request.cookieString = cookieString.replace('Cookie: ', '')
  }
  if (multipartUploads) {
    request.multipartUploads = multipartUploads
  }
  if (parsedArguments.data) {
    request.data = parsedArguments.data
  } else if (parsedArguments['data-binary']) {
    request.data = parsedArguments['data-binary']
    request.isDataBinary = true
  } else if (parsedArguments.d) {
    request.data = parsedArguments.d
  } else if (parsedArguments['data-ascii']) {
    request.data = parsedArguments['data-ascii']
  } else if (parsedArguments['data-raw']) {
    request.data = parsedArguments['data-raw']
    request.isDataRaw = true
  }

  if (parsedArguments.u) {
    request.auth = parsedArguments.u
  }
  if (parsedArguments.user) {
    request.auth = parsedArguments.user
  }
  if (Array.isArray(request.data)) {
    request.dataArray = request.data
    request.data = request.data.join('&')
  }

  if (parsedArguments.k || parsedArguments.insecure) {
    request.insecure = true
  }
  return request
}

export const serializeCookies = cookieDict => {
  let cookieString = ''
  let i = 0
  const cookieCount = Object.keys(cookieDict).length
  for (const cookieName in cookieDict) {
    const cookieValue = cookieDict[cookieName]
    cookieString += cookieName + '=' + cookieValue
    if (i < cookieCount - 1) {
      cookieString += '; '
    }
    i++
  }
  return cookieString
}




// Example usage:
const curlCommand = `
curl 'https://pass.didapinche.com/api/harley/v3/http/api/page?page_size=20&page_num=1&collection_id=3343&keyword=&namespace_id=33&search_type=2' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: zh,zh-CN;q=0.9' \
  -H 'authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBdmF0YXIiOiJodHRwczovL3N0YXRpYy1sZWdhY3kuZGluZ3RhbGsuY29tL21lZGlhL2xBRFBEM2xHdS14R004ak5CRG5OQkRnXzEwODBfMTA4MS5qcGciLCJJRCI6MTc2NzYzLCJTZXNzaW9uIjoiNFcyTG4yalhYOENhZ0F1ekp6Y0UiLCJVc2VySUQiOiJob3VwZW5nemhvdSIsIlVzZXJOYW1lIjoi5L6v6bmP5ZGoIiwiVXNlclBob25lIjoiMTU2MjAyMjM3NTMiLCJleHAiOjE3MjAyMzU0OTB9.62SzeJuvKUYkIgpfI-BgrYswE6nocQWAJBOW6C_oGzg' \
  -H 'baggage: sentry-environment=online,sentry-release=plat-fe-harley%401.0.0,sentry-public_key=4d0ab960b10442e6aea6286f0a6d77d1,sentry-trace_id=f73a0cd20e674d41ab35c752a3a32108' \
  -H 'cache-control: no-cache' \
  -H 'cookie: Authorization=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBdmF0YXIiOiJodHRwczovL3N0YXRpYy1sZWdhY3kuZGluZ3RhbGsuY29tL21lZGlhL2xBRFBEM2xHdS14R004ak5CRG5OQkRnXzEwODBfMTA4MS5qcGciLCJJRCI6MTc2NzYzLCJTZXNzaW9uIjoiNFcyTG4yalhYOENhZ0F1ekp6Y0UiLCJVc2VySUQiOiJob3VwZW5nemhvdSIsIlVzZXJOYW1lIjoi5L6v6bmP5ZGoIiwiVXNlclBob25lIjoiMTU2MjAyMjM3NTMiLCJleHAiOjE3MjAyMzU0OTB9.62SzeJuvKUYkIgpfI-BgrYswE6nocQWAJBOW6C_oGzg' \
  -H 'lane: dev-AI-2733' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://pass.didapinche.com/harley/v3/project/api?pid=33&type=1&treeId=8341&env=159' \
  -H 'sec-ch-ua: "Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "macOS"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'sentry-trace: f73a0cd20e674d41ab35c752a3a32108-b111c7e35624d940' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
`;

const curlCommand2 = `
curl 'https://cmsprod-ecs.didapinche.com/cms/cmsprod/carpool/lowEndOrder/config/createOrUpdate' \
  -H 'Accept: application/json, text/plain, */*' \
  -H 'Accept-Language: zh,zh-CN;q=0.9' \
  -H 'Cache-Control: no-cache' \
  -H 'Connection: keep-alive' \
  -H 'Content-Type: application/json;charset=UTF-8' \
  -H 'Cookie: cmsauth={%22userId%22:10452%2C%22token%22:%22fcb2fb7b63dc8625f813c12392cc6c3f%22%2C%22userName%22:%22%E4%BE%AF%E9%B9%8F%E5%91%A8%22}; d2admin-1.0.0-uuid=a1c093a3-f5bd-42aa-b569-c925e604f9dc; d2admin-1.0.0-token=a1c093a3-f5bd-42aa-b569-c925e604f9dc; acw_tc=0bdd34fa17201737784937688ec83b0382eb0f791ced5d293fb5357eb7902c' \
  -H 'Origin: https://cmsprod-ecs.didapinche.com' \
  -H 'Pragma: no-cache' \
  -H 'Referer: https://cmsprod-ecs.didapinche.com/' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' \
  -H 'X-Cms-Menuurl: /systemconfig/rateConfig' \
  -H 'X-Cms-Token: fcb2fb7b63dc8625f813c12392cc6c3f' \
  -H 'X-Cms-Type: prod' \
  -H 'X-Cms-UserId: 10452' \
  -H 'X-Cms-UserName: %E4%BE%AF%E9%B9%8F%E5%91%A8' \
  -H 'X-Token: a1c093a3-f5bd-42aa-b569-c925e604f9dc' \
  -H 'ddcinfo: DD6XZXxZv0Hvb01oharPE2zfOU5QMp7pt4O+ucww6wDRRUTh8ZBwViILxCMbkErNrxeRkrZ6nIZ8wIvYUrwhbTwnO8siMViCnnTTRKjiJx7LD/PN1y7OtXjpUq394tIL8wHAKcWv3xvR7pKqU8q0GzZBAMWRreVsWSA2491MIQNohq9R1u4/YMj3sOjUIRhMMcGDUPrPPKZgmJvblVZUgUQPbjGIhK3TF8qCXS3SUbsGHKD/N8JNKE6y2ykYY5kf' \
  -H 'lane: dev-AI-2733' \
  -H 'sec-ch-ua: "Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "macOS"' \
  --data-raw '{"id":5,"name":"7.5测试-7日封禁","type":1,"groupId":"user_group_user_20144_p","status":2,"punishId":6,"groupName":"低完单率车主管控-7日封禁","sysOpId":10452,"sysOpIp":"127.0.0.1"}'
`

// const axiosConfig = parseCurlCommand(curlCommand2);
// console.log('Axios Config:', axiosConfig);