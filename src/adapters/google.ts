export interface GoogleConfig {clientId?:string;clientSecret?:string;refreshToken?:string}
export async function googleToken(config:GoogleConfig) {
  if(!config.clientId||!config.clientSecret||!config.refreshToken)throw new Error('Google-fiók nincs csatlakoztatva.');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('A Google-hozzáférés lejárt vagy visszavonva. Csatlakoztasd újra a fiókot.');
  const data=await response.json() as {access_token?:string};if(!data.access_token)throw new Error('Hiányzó Google-hozzáférés.');return data.access_token;
}
export async function googleGet<T>(url:string,token:string):Promise<T>{
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Google beolvasási hiba (${response.status}).`);
  return response.json() as Promise<T>;
}
