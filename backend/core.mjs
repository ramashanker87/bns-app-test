import crypto from 'node:crypto';
export const token=()=>crypto.randomBytes(24).toString('base64url');
export const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
export const phone=x=>{const p=String(x||'').replace(/[\s().-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(p))throw Error('Phone must be E.164');return p};
export const totals=rows=>{const t={expected:rows.length,completed:0,missing:0,late:0,progress:0};for(const r of rows){if(r.status==='completed'){t.completed++;t.progress+=Number(r.progress||0);if(r.submittedAt>r.dueAt)t.late++}else if(new Date(r.dueAt)<new Date())t.missing++}return {...t,completion:t.expected?Math.round(100*t.completed/t.expected):0}};
export function validTwilio(url,body,signature,authToken){if(!signature||!authToken)return false;const params=new URLSearchParams(body);const sorted=[...params.entries()].sort(([a],[b])=>a.localeCompare(b));const data=url+sorted.map(([k,v])=>k+v).join('');const expected=crypto.createHmac('sha1',authToken).update(data).digest('base64');const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
export const safeFile=(type,size)=>['image/jpeg','image/png','application/pdf'].includes(type)&&Number(size)>0&&Number(size)<=10_000_000;
