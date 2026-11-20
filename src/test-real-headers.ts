import axios from 'axios';

// Let's test the user's session with the exact headers from Screenshot 5/6
const session = {
  "mobile": "9361081721",
  "user_id": 615597378,
  "phone": "+919361081721",
  "xo": "eyJ0eXBlIjoiY29tcG9zaXRlIn0=.eyJqd3QiOiJleUpoYkdjaU9pSklVekkxTmlJc0ltaDBkSEJ6T2k4dmJXVmxjMmh2TG1OdmJTOXBjMjlmWTI5MWJuUnllVjlqYjJSbElqb2lTVTRpTENKb2RIUndjem92TDIxbFpYTm9ieTVqYjIwdmRtVnljMmx2YmlJNklqRWlMQ0owZVhBaU9pSktWMVFpZlEuZXlKbGVIQWlPakUzT1RVd05qSTJOellzSW1oMGRIQnpPaTh2YldWbGMyaHZMbU52YlM5cGJuTjBZVzVqWlY5cFpDSTZJbUUzTkRaak9XTTVZVFEzTTJFNU1XUTJPRGsxTXpZeU5HWmlZbUUzWXpSbUlpd2lhSFIwY0hNNkx5OXRaV1Z6YUc4dVkyOXRMM1Z6WlhKZmFXUWlPaUkyTVRVMU9UY3pOemdpTENKcFlYUWlPakUzT1RRNE9EazROelo5LmttbVpMbm14SXY4RHZOUnNjZU9tbnZRamNjYTNtUlA1cUNaTVAybDIwTEUiLCJ4byI6IjY5MDAwMzU3NTJlMDQ2NDc5NWE2ZTIyMWQ0Y2UwY2VhIn0=",
  "ox": "BGEfhT-YLzNalVuLlh8NqNNH1rw8YBRhTtTKFFU9Tp9e7bS7hGsACF6OOSyn6Cm0dWO_JUbcoGcPik_-HQzfjwqv3p_WokYTfTf4klZwCCd5jukOIGu6KgjzoLl6mY0hu2iJxA",
  "instance_id": "a746c9c9a473a91d68953624fbba7c4f",
  "gaid": "13209d93-9de2-425d-9f23-600efd42cc00"
};

const phone = (session.phone || session.mobile).replace(/^\+?91/, '');
const uToken = Buffer.from('+91' + phone).toString('base64');
console.log('u-token:', uToken);

// Try both authorization values:
// 1) 32c4d8137cn9eb493a1921f203173080 (from mitmproxy)
// 2) innerJwt
// 3) session.xo
const authVariants = [
  '32c4d8137cn9eb493a1921f203173080',
  session.xo
];

async function test() {
  for (const auth of authVariants) {
    console.log('\n--- Testing with auth:', auth.slice(0, 35) + '... ---');
    const headers = {
      'authorization': auth,
      'app-version': '29.9',
      'app-version-code': '877',
      'instance-id': session.instance_id,
      'country-iso': 'in',
      'application-id': 'com.meesho.supply',
      'app-session-id': '809e185e-e675-4759-8815-4a8ab80db591',
      'app-sdk-version': '32',
      'app-client-id': 'android',
      'shield-session-id': '4e0bb6fe9c034a0d9b686ce9199b98ee',
      'xo': session.xo,
      'app-user-id': String(session.user_id),
      'u-token': uToken,
      'meesho-user-context': 'logged_in',
      'user-agent': 'Cronet',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json'
    };

    try {
      const res = await axios.get('https://prod.meeshoapi.com/api/3.0/addresses', {
        params: {
          offset: 0,
          limit: 50,
          check_pin: true,
          context: 'cart',
          cart_identifier: 'buy_now'
        },
        headers,
        timeout: 8000
      });
      console.log('SUCCESS status:', res.status);
      console.log('Data:', JSON.stringify(res.data).slice(0, 200));
      return;
    } catch (e: any) {
      console.log('Error status:', e.response?.status);
      console.log('Error data:', e.response?.data || e.message);
    }
  }
}

test();

