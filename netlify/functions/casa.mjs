import { getStore } from '@netlify/blobs';
import { createBridge } from '../lib/bridge.mjs';

export default async (request, context) => {
  try {
    const env = process.env;
    // Store creation uses only Netlify's managed function credentials.
    const store = getStore({name:'casa-mcp-v1',consistency:'strong'});
    return await createBridge({env,store})(request,context);
  } catch {
    return Response.json({error:'Serviço temporariamente indisponível.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
};

export const config = {path:['/mcp','/chatgpt','/oauth/*','/bridge/*','/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server']};
