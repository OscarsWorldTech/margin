import {isIP} from 'node:net';

function address(value='') {
  const ip=value.toLowerCase().replace(/^::ffff:/,'');
  if(!isIP(ip))return '';
  return isIP(ip)===6?new URL(`http://[${ip}]`).hostname:ip;
}
function loopback(ip) { return ip==='[::1]' || /^127\./.test(ip); }

export function securityConfig(env) {
  const trustedProxies=new Set();
  for(const value of (env.TRUSTED_PROXIES||'').split(',').map(s=>s.trim()).filter(Boolean)) {
    const ip=address(value);
    if(!ip)throw new Error('TRUSTED_PROXIES must contain exact proxy IP addresses, not hostnames or CIDRs.');
    trustedProxies.add(ip);
  }
  return {trustedProxies,allowInsecure:env.ALLOW_INSECURE_HTTP==='true',forceSecureCookie:env.COOKIE_SECURE==='true'};
}

export function requestSecurity(req,config) {
  const peer=address(req.socket.remoteAddress);
  const trusted=config.trustedProxies.has(peer);
  const secure=Boolean(req.socket.encrypted)||(trusted&&req.headers['x-forwarded-proto']==='https');
  let host='';
  try {host=new URL(`http://${req.headers.host}`).hostname;}catch{/* Invalid hosts are not local. */}
  // Both ends must be loopback. Forwarded requests never qualify for the local
  // development exception, even when a proxy rewrites Host to localhost.
  const forwarded=['forwarded','x-forwarded-for','x-forwarded-proto','x-forwarded-host'].some(h=>req.headers[h]!==undefined);
  const local=!forwarded&&loopback(peer)&&(host==='localhost'||loopback(address(host.replace(/^\[|\]$/g,''))));
  // Support one proxy which OVERWRITES X-Forwarded-For. Ambiguous chains fall
  // back to the socket peer; never guess which user-controlled hop is genuine.
  const forwardedClient=trusted?address(req.headers['x-forwarded-for']):'';
  return {allowed:secure||local||config.allowInsecure,secure,client:forwardedClient||peer||'unknown',secureCookie:secure||config.forceSecureCookie};
}

export function validatePassword(password) {
  if(typeof password!=='string'||password.trim().length<16||/^(.)\1+$/.test(password)||/^(replace-with|choose-a-|change-?me|your[-_ ])/i.test(password))
    throw new Error('Set MARGIN_PASSWORD to a unique password of at least 16 characters (not the example placeholder).');
}

export const browserPolicies={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** Fixed windows cap work; failure backoff rejects promptly without sleeping.
 * Entries expire and cannot exceed maxSources. Saturation rejects NEW sources
 * rather than evicting blocked sources and letting them bypass their limit.
 */
export class LoginLimiter {
  constructor({windowMs=60000,perSource=10,globalLimit=100,maxSources=4096}={}) {
    Object.assign(this,{windowMs,perSource,globalLimit,maxSources});
    this.sources=new Map();this.global={count:0,until:0};
  }
  take(source,now=Date.now()) {
    for(const [key,value] of this.sources)if(value.until<=now)this.sources.delete(key);
    if(this.global.until<=now)this.global={count:0,until:now+this.windowMs};
    const old=this.sources.get(source);
    const retry=Math.max(old?.blockedUntil||0,old?.count>=this.perSource?old.until:0,
      this.global.count>=this.globalLimit?this.global.until:0);
    if(retry>now)return Math.max(1,Math.ceil((retry-now)/1000));
    if(!old&&this.sources.size>=this.maxSources)return Math.max(1,Math.ceil(this.windowMs/1000));
    const entry=old||{count:0,failures:0,blockedUntil:0,until:now+this.windowMs};
    entry.count++;this.global.count++;this.sources.set(source,entry);
    return 0;
  }
  failed(source,now=Date.now()) {
    const entry=this.sources.get(source);if(!entry)return;
    entry.failures++;
    if(entry.failures>=3)entry.blockedUntil=Math.min(entry.until,now+Math.min(30000,1000*2**Math.min(5,entry.failures-3)));
  }
  succeeded(source) {
    const entry=this.sources.get(source);
    if(entry){entry.failures=0;entry.blockedUntil=0;}
    // Successful logins still count against both request budgets.
  }
}
