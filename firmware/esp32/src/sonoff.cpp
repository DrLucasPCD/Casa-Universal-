// Protocol reference: AlexxIT/SonoffLAN/core/ewelink/local.py, MIT.
// See docs/sonoff.md and third_party/LICENSE-SonoffLAN.txt.
#include "sonoff.h"
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <mbedtls/aes.h>
#include <mbedtls/md5.h>
#include <map>
#include <time.h>

namespace {
struct Seen { String ip, raw, params; uint16_t port=8081; uint32_t observed=0; };
std::map<String,Seen> seen;
uint32_t nextScan=0;
uint64_t sequence=0;
constexpr size_t LIMIT=16384;

bool supported(JsonObject d){return d["adapter"]=="sonoff_lan"||d["adapter"]=="sonoff_diy";}
bool identifier(const String& id){if(id.length()<8||id.length()>40)return false;for(char c:id)if(!isalnum((unsigned char)c))return false;return true;}
bool decrypt(const String& data,const String& encodedIV,const String& key,Doc& result){
  if(data.length()>5500||!data.length())return false;
  auto iv=unbase64(encodedIV),raw=unbase64(data);if(iv.size()!=16||raw.empty()||raw.size()%16)return false;
  uint8_t digest[16];if(mbedtls_md5_ret((const uint8_t*)key.c_str(),key.length(),digest))return false;
  mbedtls_aes_context aes;mbedtls_aes_init(&aes);mbedtls_aes_setkey_dec(&aes,digest,128);
  int rc=mbedtls_aes_crypt_cbc(&aes,MBEDTLS_AES_DECRYPT,raw.size(),iv.data(),raw.data(),raw.data());mbedtls_aes_free(&aes);
  if(rc)return false;uint8_t padding=raw.back();if(!padding||padding>16||padding>raw.size())return false;
  for(size_t i=raw.size()-padding;i<raw.size();i++)if(raw[i]!=padding)return false;
  return !deserializeJson(result,raw.data(),raw.size()-padding)&&result.is<JsonObject>();
}
bool encrypt(JsonObject params,const String& key,JsonObject payload){
  String text;serializeJson(params,text);size_t size=(text.length()/16+1)*16;
  std::vector<uint8_t> raw(size,(uint8_t)(size-text.length()));memcpy(raw.data(),text.c_str(),text.length());
  uint8_t digest[16],iv[16],workingIV[16];esp_fill_random(iv,16);memcpy(workingIV,iv,16);
  if(mbedtls_md5_ret((const uint8_t*)key.c_str(),key.length(),digest))return false;
  mbedtls_aes_context aes;mbedtls_aes_init(&aes);mbedtls_aes_setkey_enc(&aes,digest,128);
  int rc=mbedtls_aes_crypt_cbc(&aes,MBEDTLS_AES_ENCRYPT,size,workingIV,raw.data(),raw.data());mbedtls_aes_free(&aes);
  if(rc)return false;payload["encrypt"]=true;payload["iv"]=base64(iv,16);payload["data"]=base64(raw.data(),raw.size());return true;
}
// HTTPClient decodes chunked bodies. This sink stops before oversized responses.
struct Bounded : Stream {String text;int available() override{return 0;}int read() override{return -1;}int peek() override{return -1;}void flush() override{}size_t write(uint8_t b) override {if(text.length()>=LIMIT)return 0;text+=(char)b;return 1;}size_t write(const uint8_t* p,size_t n) override {if(n>LIMIT-text.length())return 0;text+=String((const char*)p,n);return n;}};

void observe(JsonObject d,JsonObject params,const String& ip,uint16_t port,const String& raw){
  String id=d["id"]|"";auto& state=seen[id];state.ip=ip;state.port=port;
  // Repeated advertisements are not new observations; stale state must expire.
  if(state.raw==raw)return;state.raw=raw;state.params="";serializeJson(params,state.params);state.observed=millis();
}
void scan(JsonArray output,bool force){
  if(WiFi.status()!=WL_CONNECTED||(!force&&(int32_t)(nextScan-millis())>0))return;nextScan=millis()+15000;
  int count=MDNS.queryService("ewelink","tcp");
  for(int i=0;i<count&&i<32;i++){
    String id=MDNS.txt(i,"id"),ip=MDNS.IP(i).toString();IPAddress address;if(!identifier(id)||!localIP(ip,address))continue;
    uint16_t port=MDNS.port(i);if(!port)port=8081;bool encrypted=MDNS.txt(i,"encrypt")=="true";
    if(!output.isNull()){auto item=output.createNestedObject();item["device_id"]=id;item["ip"]=ip;item["port"]=port;item["type"]=MDNS.txt(i,"type");item["encrypted"]=encrypted;}
    String raw;for(int part=1;part<=4;part++)raw+=MDNS.txt(i,("data"+String(part)).c_str());if(raw.length()>5500)continue;
    for(auto value:house["devices"].as<JsonArray>()){
      auto d=value.as<JsonObject>();if(!supported(d)||d["config"]["device_id"]!=id)continue;
      if(!raw.length())continue;Doc data(16384);bool ok=false;
      if(encrypted&&d["adapter"]=="sonoff_lan")ok=decrypt(raw,MDNS.txt(i,"iv"),d["config"]["device_key"]|"",data);
      else if(!encrypted&&d["adapter"]=="sonoff_diy")ok=!deserializeJson(data,raw)&&data.is<JsonObject>();
      if(ok)observe(d,data.as<JsonObject>(),ip,port,MDNS.txt(i,"seq")+"/"+MDNS.txt(i,"iv")+"/"+raw);
    }
  }
}
bool request(JsonObject d,const String& operation,JsonObject params,bool reading){
  auto cfg=d["config"].as<JsonObject>();bool diy=d["adapter"]=="sonoff_diy";if(!sonoffValidate(cfg,diy))return false;
  String id=d["id"]|"",ip=cfg["ip"]|"";uint16_t port=cfg["port"]|8081;
  auto cached=seen.find(id);if(cached!=seen.end()&&cached->second.ip.length()){ip=cached->second.ip;port=cached->second.port;}
  Doc payload(4096);uint64_t now=(uint64_t)time(nullptr)*1000+millis()%1000;if(now<=sequence)now=sequence+1;sequence=now;
  char number[24];snprintf(number,sizeof(number),"%llu",(unsigned long long)sequence);
  payload["sequence"]=number;payload["deviceid"]=cfg["device_id"];payload["selfApikey"]="123";
  if(diy)payload["data"]=params;else if(!encrypt(params,cfg["device_key"]|"",payload.as<JsonObject>())){lastError="Não foi possível criptografar o comando Sonoff.";return false;}
  String body;serializeJson(payload,body);WiFiClient client;HTTPClient http;http.setTimeout(2000);http.setConnectTimeout(1800);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);http.setReuse(false);
  if(!http.begin(client,"http://"+ip+":"+String(port)+"/zeroconf/"+operation)){lastError="Conexão Sonoff indisponível.";return false;}
  http.addHeader("Content-Type","application/json");http.addHeader("Connection","close");
  // A timeout is ambiguous. Never retry actuator packets automatically.
  int status=http.POST(body);Bounded sink;int read=status==200&&http.getSize()<=(int)LIMIT?http.writeToStream(&sink):-1;http.end();
  if(status!=200||read<0){lastError="Sonoff sem resposta confirmada. Confira Wi-Fi, modo LAN e device key; não repita automaticamente.";return false;}
  Doc response(16384);if(deserializeJson(response,sink.text)||!response.is<JsonObject>()){
    if(reading&&sink.text.indexOf('<')>=0)return true;lastError="Resposta Sonoff inválida; comando não confirmado.";return false;
  }
  if(!response["error"].is<int>()){lastError="Resposta Sonoff sem confirmação.";return false;}
  if(response["error"]!=0){if(reading)return true;lastError="Sonoff recusou o comando LAN. Confira a chave deste aparelho.";return false;}
  Doc data(16384);bool decoded=false;
  if(response["iv"].is<const char*>()&&!diy)decoded=decrypt(response["data"]|"",response["iv"]|"",cfg["device_key"]|"",data);
  else if(diy&&response["data"].is<JsonObject>()){data.set(response["data"]);decoded=true;}
  if(response.containsKey("iv")&&!decoded){lastError="Não foi possível validar o estado criptografado do Sonoff.";return false;}
  if(decoded)observe(d,data.as<JsonObject>(),ip,port,sink.text);
  else if(!reading){auto it=seen.find(id);if(it!=seen.end()){it->second.params="";it->second.observed=0;}}
  return true;
}
}

bool sonoffValidate(JsonObject cfg,bool diy){
  IPAddress ip;int port=cfg["port"]|8081,channels=cfg["channels"]|1;String id=cfg["device_id"]|"",key=cfg["device_key"]|"";
  if(!localIP(cfg["ip"]|"",ip)||!identifier(id)||port<1||port>65535||channels<1||channels>4){lastError="Confira IP privado, device ID, porta e canais (1 a 4).";return false;}
  if(diy?cfg["diy_confirmed"]!=true:key.length()<16||key.length()>128){lastError=diy?"Confirme que o Sonoff já está em modo DIY.":"Informe a device key pessoal do seu Sonoff obtida pelo SonoffLAN/eWeLink.";return false;}return true;
}
bool sonoffSend(JsonObject d,const String& action){
  int count=d["config"]["channels"]|1;Doc params(1024);String operation;
  if(count==1&&(action=="on"||action=="off")){operation="switch";params["switch"]=action;}
  else if(count>1){for(int channel=1;channel<=count;channel++)for(const char* state:{"on","off"})if(action==String(state)+"_"+String(channel)){operation="switches";auto outlet=params.createNestedArray("switches").createNestedObject();outlet["outlet"]=channel-1;outlet["switch"]=state;}}
  if(!operation.length()){lastError="Escolha ligar/desligar um canal válido do Sonoff.";return false;}
  return request(d,operation,params.as<JsonObject>(),false);
}
void sonoffStatus(JsonObject d,JsonObject out){
  scan(JsonArray(),false);Doc empty(64);bool online=request(d,"getState",empty.to<JsonObject>(),true);
  out["available"]=online;out["state"]=online?"unknown":"unavailable";out["state_source"]="SonoffLAN · eWeLink local";
  if(!online){out["message"]=lastError;return;}
  int count=d["config"]["channels"]|1;JsonArray channels;if(count>1){channels=out.createNestedArray("channels");for(int i=1;i<=count;i++){auto c=channels.createNestedObject();c["channel"]=i;c["state"]="unknown";}}
  auto it=seen.find(String(d["id"]|""));bool fresh=it!=seen.end()&&it->second.observed&&millis()-it->second.observed<60000;
  if(fresh){Doc data(16384);deserializeJson(data,it->second.params);String state=data["switch"]|"";if(count==1&&(state=="on"||state=="off"))out["state"]=state;
    for(auto s:data["switches"].as<JsonArray>())if(s["outlet"].is<int>()&&(s["switch"]=="on"||s["switch"]=="off")){int n=s["outlet"].as<int>();if(n>=0&&n<count&&!channels.isNull())channels[n]["state"]=s["switch"];}
    if(count>1){bool complete=true,anyOn=false;for(auto channel:channels){String value=channel["state"]|"unknown";complete&=value=="on"||value=="off";anyOn|=value=="on";}if(complete)out["state"]=anyOn?"on":"off";}
    out["observation_age_seconds"]=(millis()-it->second.observed)/1000;
  }
  out["message"]=fresh?"Estado recebido do aparelho pela rede local.":"Sonoff respondeu. Aguardando um estado confirmado; anúncios sem atualização expiram em 60 segundos.";
}
void sonoffDiscover(JsonArray output){scan(output,true);}
void sonoffLoop(){for(auto d:house["devices"].as<JsonArray>())if(supported(d.as<JsonObject>())){scan(JsonArray(),false);break;}}
void sonoffForget(const String& id){seen.erase(id);nextScan=0;}
