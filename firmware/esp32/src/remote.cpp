#include "remote.h"
#include "netlify_roots.h"
#include <Preferences.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>

static Preferences remotePrefs;
static String endpoint,credential,previousId,phase="disabled",lastResultId;
static Doc lastResult(0);
static uint32_t nextPoll=0;
static bool enabled=false,ackPending=false;

static int request(const String& path,const String& body,Doc& output){
  WiFiClientSecure client;client.setCACert(NETLIFY_ROOTS);client.setHandshakeTimeout(5);
  HTTPClient http;http.setTimeout(5000);http.setConnectTimeout(3000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(client,endpoint+path))return -1;
  http.addHeader("Authorization","Bearer "+credential);http.addHeader("Content-Type","application/json");
  int status=http.POST(body);if(status>0&&http.getSize()<=32768){String raw=http.getString();if(raw.length()<=32768)deserializeJson(output,raw);}http.end();return status;
}
void remoteInit(){
  remotePrefs.begin("casa_remote",false);endpoint=remotePrefs.getString("url","");credential=remotePrefs.getString("token","");
  enabled=remotePrefs.getBool("enabled",false)&&endpoint=="https://casa-universal.netlify.app"&&credential.length()==43;
  previousId=remotePrefs.getString("seen","");lastResult=Doc(65536);phase=enabled?"pending":"disabled";
}
bool remoteConfigure(JsonObject input){
  if(input["enabled"]==false){enabled=false;remotePrefs.putBool("enabled",false);phase="disabled";return true;}
  String url=input["url"]|"",token=input["token"]|"";
  if(url!="https://casa-universal.netlify.app"||token.length()!=43){lastError="Confira a configuração privada do Netlify.";return false;}
  for(char c:token)if(!isalnum(c)&&c!='-'&&c!='_'){lastError="Credencial remota inválida.";return false;}
  // USB only. This credential is never returned by the local API or status.
  remotePrefs.putString("url",url);remotePrefs.putString("token",token);remotePrefs.putBool("enabled",true);
  endpoint=url;credential=token;enabled=true;nextPoll=0;phase="pending";return true;
}
void remoteStatus(Doc& result){result["enabled"]=enabled;result["phase"]=phase;result["site"]=endpoint;}
static void acknowledge(){
  Doc envelope(65536),response(2048);envelope["id"]=lastResultId;envelope["result"]=lastResult;
  if(measureJson(envelope)>32768){envelope.clear();envelope["id"]=lastResultId;envelope["result"]["isError"]=true;auto content=envelope["result"].createNestedArray("content").createNestedObject();content["type"]="text";content["text"]="Resultado excede o limite da ponte. Use o painel local.";}
  String body;serializeJson(envelope,body);int status=request("/bridge/result",body,response);
  if(status==200||status==400){ackPending=false;lastResult.clear();phase="connected";}else phase="unavailable";
}
void remotePoll(){
  if(!enabled||WiFi.status()!=WL_CONNECTED||(int32_t)(nextPoll-millis())>0)return;
  nextPoll=millis()+15000;
  if(time(nullptr)<1700000000){phase="pending";return;}
  if(ackPending){acknowledge();return;}
  Doc response(32768);int status=request("/bridge/poll","{}",response);
  if(status!=200){phase=status==401||status==503?"setup_required":"unavailable";return;}phase="connected";
  auto job=response["job"].as<JsonObject>();if(job.isNull())return;
  String jobId=job["id"]|"",name=job["name"]|"";uint64_t expires=job["expires_at"].as<uint64_t>();
  if(jobId.length()!=32||expires<=((uint64_t)time(nullptr))*1000||jobId==previousId)return;
  // Persist before execution. After a reboot an uncertain command is never
  // retried automatically; the cloud will report its result as unconfirmed.
  if(remotePrefs.putString("seen",jobId)!=jobId.length()){phase="unavailable";return;}previousId=jobId;
  phase="executing";Doc result(128000);bool ok=runRemoteTool(name,job["arguments"].as<JsonObject>(),result);
  lastResult.clear();lastResult["isError"]=!ok;if(!ok){result.clear();result["error"]=lastError.length()?lastError:"Ferramenta remota inválida.";}
  String raw;serializeJson(result,raw);auto content=lastResult.createNestedArray("content").createNestedObject();content["type"]="text";content["text"]=raw;
  lastResult["structuredContent"]=result;lastResultId=jobId;ackPending=true;acknowledge();
}
