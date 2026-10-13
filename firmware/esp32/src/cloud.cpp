#include "cloud.h"
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <mbedtls/sha256.h>
#include "vendor/miniz.h"
#include "google_roots.h"
#include <time.h>

static Doc config(0),hashes(0);
static Preferences cloudPrefs;
static String token,phase="pending",message="Aguardando Wi-Fi para sincronizar com o Firestore.",lastSynced;
static uint32_t tokenUntil=0,nextAttempt=0;
static bool dirty=true,configured=false;

static String hash(const String& s){uint8_t bytes[32];mbedtls_sha256_ret((const uint8_t*)s.c_str(),s.length(),bytes,0);String result;for(auto b:bytes){char v[3];snprintf(v,3,"%02x",b);result+=v;}return result;}
static void portable(JsonObject device,Doc& result) {
  for(const char* key:{"id","name","room","kind","adapter","generic_remote","ir_profile"})if(device.containsKey(key))result[key]=device[key];
  auto cfg=result.createNestedObject("config");auto original=device["config"].as<JsonObject>();
  for(const char* key:{"ip","mac","port","devtype","commands","parent_id","device_id","version","dp","cover_type","temperature_dp","target_temperature_dp","position_dp","temperature_divisor","temperature_unit","humidity_dp","humidity_divisor","display_type","channels","diy_confirmed","bluetooth_id","bluetooth_name","url","entity_id","remote_device","feedback_url","feedback_entity","feedback_enabled"})if(original.containsKey(key))cfg[key]=original[key];
}
static String collection(){return "https://firestore.googleapis.com/v1/projects/"+String(config["projectId"]|"")+"/databases/(default)/documents/casas/"+String(config["uid"]|"")+"/controles";}
static int request(const String& url,const String& method,const String& body,Doc& result,bool auth=true,const char* content="application/json"){
  WiFiClientSecure client;client.setCACert(GOOGLE_ROOTS);client.setHandshakeTimeout(8);HTTPClient http;http.setTimeout(8000);http.setConnectTimeout(5000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(client,url))return -1;http.addHeader("Content-Type",content);if(auth)http.addHeader("Authorization","Bearer "+token);
  // HTTPClient decodes chunked responses; the raw stream includes chunk sizes.
  int status=http.sendRequest(method.c_str(),(uint8_t*)body.c_str(),body.length());if(status>0&&http.getSize()<=32768){String response=http.getString();if(response.length()<=32768)deserializeJson(result,response);}http.end();return status;
}
static bool authenticate(){
  if(token.length()&&(int32_t)(tokenUntil-millis())>0)return true;
  String refresh=cloudPrefs.getString("refresh",config["refresh_token"]|"");if(!refresh.length())return false;
  // Firebase refresh tokens contain only URL-safe characters; encode defensively.
  String encoded;for(size_t i=0;i<refresh.length();i++){char c=refresh[i];if(isalnum(c)||c=='_'||c=='-'||c=='.'||c=='~')encoded+=c;else{char v[4];snprintf(v,4,"%%%02X",(uint8_t)c);encoded+=v;}}
  Doc response(32768);int status=request("https://securetoken.googleapis.com/v1/token?key="+String(config["apiKey"]|""),"POST","grant_type=refresh_token&refresh_token="+encoded,response,false,"application/x-www-form-urlencoded");
  if(status!=200||response["user_id"]!=config["uid"]){message="A identidade Firebase não foi validada (HTTP "+String(status)+"). Cópia local preservada.";return false;}
  token=response["id_token"].as<String>();String updated=response["refresh_token"]|"";if(updated.length())cloudPrefs.putString("refresh",updated);
  int seconds=response["expires_in"].as<int>();if(seconds<120)seconds=120;tokenUntil=millis()+(seconds-60)*1000;return token.length()>0;
}
void cloudInit(){
  config=Doc(16384);hashes=Doc(16384);cloudPrefs.begin("casa_cloud",false);
  auto file=LittleFS.open("/cloud.json");if(file&&!deserializeJson(config,file)&&String(config["uid"]|"").length()&&String(config["refresh_token"]|"").length())configured=true;
  deserializeJson(hashes,cloudPrefs.getString("hashes","{}"));lastSynced=cloudPrefs.getString("last_synced","");
  configTime(0,0,"time.google.com","pool.ntp.org");if(!configured){phase="setup_required";message="Cópia local salva. Configure a identidade Firebase pelo USB.";}
}
void cloudChanged(){dirty=true;nextAttempt=millis()+5000;}
void cloudStatus(Doc& result){
  result["configured"]=configured;result["project"]=config["projectId"];result["phase"]=dirty&&phase=="synced"?"queued":phase;result["pending"]=dirty?house["devices"].size():0;result["message"]=message;if(lastSynced.length())result["last_synced"]=lastSynced;
}
void cloudPoll(){
  if(!configured||!dirty||WiFi.status()!=WL_CONNECTED||(int32_t)(nextAttempt-millis())>0)return;nextAttempt=millis()+45000;
  if(time(nullptr)<1700000000){phase="pending";message="Aguardando horário confiável para conectar ao Firestore.";return;}
  if(!authenticate()){phase="pending";return;}
  Doc check(32768);int status=request(collection()+"?pageSize=1&mask.fieldPaths=schema","GET","",check,false);
  String reason=check["error"]["status"]|"";
  if(!((status==401||status==403)&&(reason=="PERMISSION_DENIED"||reason=="UNAUTHENTICATED"))){phase="setup_required";message="As regras privadas não foram confirmadas; nenhum controle foi enviado.";return;}
  phase="syncing";
  for(auto item:house["devices"].as<JsonArray>()){
    Doc data(768000);portable(item,data);if(data.overflowed()){phase="pending";message="Controle grande demais para a cópia na nuvem.";return;}String raw;serializeJson(data,raw);String digest=hash(raw),id=item["id"].as<String>();if(hashes[id]==digest)continue;
    mz_ulong bound=mz_compressBound(raw.length());auto compressed=(uint8_t*)ps_malloc(bound);if(!compressed||mz_compress2(compressed,&bound,(const uint8_t*)raw.c_str(),raw.length(),6)!=MZ_OK){free(compressed);phase="pending";message="Memória insuficiente para compactar. Cópia local preservada.";return;}
    String encoded=base64(compressed,bound);free(compressed);if(encoded.length()>850000){phase="pending";message="Controle excede o limite de cópia na nuvem.";return;}
    Doc document(encoded.length()+8192);auto fields=document.createNestedObject("fields");for(const char* k:{"name","room","kind"})fields[k]["stringValue"]=item[k];fields["schema"]["integerValue"]="1";fields["encoding"]["stringValue"]="zlib+base64";fields["data"]["stringValue"]=encoded;fields["digest"]["stringValue"]=digest;
    time_t now=time(nullptr);struct tm utc;gmtime_r(&now,&utc);char stamp[32];strftime(stamp,32,"%Y-%m-%dT%H:%M:%SZ",&utc);fields["savedAt"]["timestampValue"]=stamp;String body;serializeJson(document,body);Doc response(32768);
    status=request(collection()+"/"+id+"?mask.fieldPaths=digest","PATCH",body,response);
    if(status!=200||response["fields"]["digest"]["stringValue"]!=digest){phase="pending";message="Firestore indisponível. Os controles continuam salvos no ESP32.";return;}
    hashes[id]=digest;String saved;serializeJson(hashes,saved);cloudPrefs.putString("hashes",saved);lastSynced=stamp;cloudPrefs.putString("last_synced",lastSynced);
    // Service panel, USB and MCP between uploads instead of blocking for every device.
    nextAttempt=millis()+250;return;
  }
  dirty=false;phase="synced";message="Controles salvos no Firestore. Credenciais permanecem na central ESP32.";
}
