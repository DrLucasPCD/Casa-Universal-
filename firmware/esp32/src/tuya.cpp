// Tuya LAN 3.3/3.4 interoperability. Reference: TinyTuya 1.20.0 (MIT), see docs/tuya.md.
#include "tuya.h"
#include <WiFiUdp.h>
#include <mbedtls/aes.h>
#include <mbedtls/md5.h>
#include <mbedtls/md.h>
#include <mbedtls/gcm.h>
#include <esp_system.h>
#include <time.h>
#include <set>
#include <map>
namespace {
constexpr size_t LIMIT=8192;
struct Found {String ip,version;uint32_t seen;};std::map<String,Found> discoveries;
WiFiUDP udpPlain,udpEncrypted,udpModern;bool listening=false;
uint32_t sequence=1;
uint32_t word(const uint8_t* p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
void put(std::vector<uint8_t>& p,uint32_t v){for(int i=3;i>=0;i--)p.push_back((v>>(8*i))&255);}
uint32_t crc(const uint8_t* p,size_t n){uint32_t c=~0u;for(size_t i=0;i<n;i++){c^=p[i];for(int b=0;b<8;b++)c=(c>>1)^((c&1)?0xedb88320u:0);}return ~c;}
bool crypt(std::vector<uint8_t>& data,const uint8_t* key,bool decrypt){
  if(data.empty()||data.size()>LIMIT||data.size()%16)return false;
  mbedtls_aes_context aes;mbedtls_aes_init(&aes);
  int code=decrypt?mbedtls_aes_setkey_dec(&aes,key,128):mbedtls_aes_setkey_enc(&aes,key,128);
  for(size_t i=0;!code&&i<data.size();i+=16)code=mbedtls_aes_crypt_ecb(&aes,decrypt?MBEDTLS_AES_DECRYPT:MBEDTLS_AES_ENCRYPT,data.data()+i,data.data()+i);
  mbedtls_aes_free(&aes);if(code)return false;
  if(decrypt){uint8_t pad=data.back();if(!pad||pad>16||pad>data.size())return false;for(size_t i=data.size()-pad;i<data.size();i++)if(data[i]!=pad)return false;data.resize(data.size()-pad);}
  return true;
}
bool decode(std::vector<uint8_t> body,const uint8_t* key,Doc& doc,bool& device22){
  if(body.size()>=15&&memcmp(body.data(),"3.3",3)==0)body.erase(body.begin(),body.begin()+15);
  if(!crypt(body,key,true))return false;
  String text((const char*)body.data(),body.size());
  device22=text.indexOf("data unvalid")>=0;
  return !deserializeJson(doc,text)&&doc.is<JsonObject>();
}
bool readExact(WiFiClient& client,uint8_t* p,size_t size,uint32_t until){
  size_t n=0;while(n<size&&(int32_t)(until-millis())>0){int available=client.available();if(available>0){int got=client.read(p+n,std::min((size_t)available,size-n));if(got>0)n+=got;}else if(!client.connected())break;else delay(2);}return n==size;
}
bool signedDigest(const uint8_t* key,const uint8_t* data,size_t size,uint8_t* out){return mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,16,data,size,out)==0;}
bool sameBytes(const uint8_t* a,const uint8_t* b,size_t size){uint8_t n=0;for(size_t i=0;i<size;i++)n|=a[i]^b[i];return n==0;}
bool modernPacket(std::vector<uint8_t>& packet,const uint8_t* key,std::vector<uint8_t>& body){
  if(packet.size()<50||word(packet.data())!=0x6699||word(packet.data()+14)+22!=packet.size()||word(packet.data()+packet.size()-4)!=0x9966)return false;
  size_t len=packet.size()-50;body.resize(len);mbedtls_gcm_context gcm;mbedtls_gcm_init(&gcm);
  int error=mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,key,128);
  if(!error)error=mbedtls_gcm_auth_decrypt(&gcm,len,packet.data()+18,12,packet.data()+4,14,packet.data()+packet.size()-20,16,packet.data()+30,body.data());
  mbedtls_gcm_free(&gcm);if(error)return false;
  if(body.size()>4&&body[0]!='{'&&body[4]=='{'){if(word(body.data())!=0)return false;body.erase(body.begin(),body.begin()+4);}return true;
}
void discoveryProbe(){
  uint8_t key[16],iv[12],tag[16];mbedtls_md5_ret((const uint8_t*)"yGAdlopoPVldABfn",16,key);esp_fill_random(iv,12);
  Doc data(256);data["from"]="app";data["ip"]=WiFi.localIP().toString();String raw;serializeJson(data,raw);
  std::vector<uint8_t> packet;put(packet,0x6699);packet.push_back(0);packet.push_back(0);put(packet,0);put(packet,0x25);put(packet,raw.length()+28);
  std::vector<uint8_t> body(raw.length());mbedtls_gcm_context gcm;mbedtls_gcm_init(&gcm);int error=mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,key,128);
  if(!error)error=mbedtls_gcm_crypt_and_tag(&gcm,MBEDTLS_GCM_ENCRYPT,raw.length(),iv,12,packet.data()+4,14,(const uint8_t*)raw.c_str(),body.data(),16,tag);mbedtls_gcm_free(&gcm);if(error)return;
  packet.insert(packet.end(),iv,iv+12);packet.insert(packet.end(),body.begin(),body.end());packet.insert(packet.end(),tag,tag+16);put(packet,0x9966);
  auto ip=WiFi.localIP(),mask=WiFi.subnetMask();IPAddress broadcast;for(int i=0;i<4;i++)broadcast[i]=ip[i]|((uint8_t)~mask[i]);udpModern.beginPacket(broadcast,7000);udpModern.write(packet.data(),packet.size());udpModern.endPacket();
}
bool send34(WiFiClient& client,uint32_t cmd,std::vector<uint8_t> body,const uint8_t* key,bool version=false){
  if(version){std::vector<uint8_t> prefix(15,0);memcpy(prefix.data(),"3.4",3);body.insert(body.begin(),prefix.begin(),prefix.end());}
  uint8_t pad=16-body.size()%16;body.insert(body.end(),pad,pad);if(!crypt(body,key,false))return false;
  std::vector<uint8_t> packet;put(packet,0x55aa);put(packet,sequence++);put(packet,cmd);put(packet,body.size()+36);packet.insert(packet.end(),body.begin(),body.end());uint8_t tag[32];
  if(!signedDigest(key,packet.data(),packet.size(),tag))return false;packet.insert(packet.end(),tag,tag+32);put(packet,0xaa55);
  return client.write(packet.data(),packet.size())==packet.size();
}
bool receive34(WiFiClient& client,const uint8_t* key,uint32_t expected,std::vector<uint8_t>& body,uint32_t until){
  for(int frames=0;frames<8;frames++){
    uint8_t header[16];if(!readExact(client,header,16,until))break;uint32_t n=word(header+12),cmd=word(header+8);
    if(word(header)!=0x55aa||n<40||n>LIMIT){lastError="Pacote Tuya 3.4 inválido.";return false;}
    std::vector<uint8_t> tail(n);if(!readExact(client,tail.data(),n,until))break;
    std::vector<uint8_t> check(header,header+16);check.insert(check.end(),tail.begin(),tail.end()-36);uint8_t tag[32];
    if(word(tail.data()+n-4)!=0xaa55||!signedDigest(key,check.data(),check.size(),tag)||!sameBytes(tag,tail.data()+n-36,32)){lastError="Resposta Tuya 3.4 sem autenticação válida.";return false;}
    if(word(tail.data())!=0){lastError="Tuya 3.4 recusou o pedido.";return false;}
    if(cmd!=expected&&!(expected!=4&&cmd==8))continue;
    body.assign(tail.begin()+4,tail.end()-36);if(!body.empty()&&!crypt(body,key,true)){lastError="Resposta Tuya 3.4 com criptografia inválida.";return false;}return true;
  }
  lastError="Tuya 3.4 não respondeu. Confira IP, chave e conexão LAN.";return false;
}
bool request34(JsonObject d,bool writing,JsonVariantConst value,Doc& result){
  auto cfg=d["config"].as<JsonObject>();String master=cfg["local_key"];IPAddress ip;if(!localIP(cfg["ip"]|"",ip))return false;
  WiFiClient client;if(!client.connect(ip,cfg["port"]|6668,1800)){lastError="Tuya 3.4 sem conexão TCP.";return false;}
  uint8_t local[16];esp_fill_random(local,16);const uint8_t* key=(const uint8_t*)master.c_str();std::vector<uint8_t> body(local,local+16),reply;
  if(!send34(client,3,body,key)||!receive34(client,key,4,reply,millis()+3000)||reply.size()!=48){client.stop();if(!lastError.length())lastError="Negociação Tuya 3.4 incompleta.";return false;}
  uint8_t tag[32];signedDigest(key,local,16,tag);if(!sameBytes(tag,reply.data()+16,32)){client.stop();lastError="Tuya 3.4 não confirmou a identidade da sessão.";return false;}
  signedDigest(key,reply.data(),16,tag);body.assign(tag,tag+32);if(!send34(client,5,body,key)){client.stop();lastError="Negociação Tuya 3.4 não enviada.";return false;}
  std::vector<uint8_t> session(16);for(int i=0;i<16;i++)session[i]=local[i]^reply[i];if(!crypt(session,key,false)){client.stop();return false;}
  Doc payload(2048);payload.to<JsonObject>();if(writing){payload["protocol"]=5;payload["t"]=(unsigned long)time(nullptr);payload["data"]["dps"][String(cfg["dp"]|1)]=value;}
  String raw;serializeJson(payload,raw);body.assign((const uint8_t*)raw.c_str(),(const uint8_t*)raw.c_str()+raw.length());uint32_t cmd=writing?13:16;
  if(!send34(client,cmd,body,session.data(),writing)){client.stop();lastError="Envio Tuya 3.4 incompleto; confira o aparelho antes de repetir.";return false;}
  uint32_t until=millis()+3000;
  for(int frames=0;frames<8;frames++){
    if(!receive34(client,session.data(),cmd,reply,until)){client.stop();return false;}
    if(reply.empty()){if(writing){client.stop();return true;}continue;}
    if(reply.size()>=15&&memcmp(reply.data(),"3.4",3)==0)reply.erase(reply.begin(),reply.begin()+15);
    // Const input makes ArduinoJson own strings after the reply buffer is freed.
    if(deserializeJson(result,(const uint8_t*)reply.data(),reply.size())){client.stop();lastError="Estado Tuya 3.4 inválido.";return false;}
    if(!result["dps"].is<JsonObject>()&&result["data"]["dps"].is<JsonObject>())result["dps"]=result["data"]["dps"];
    client.stop();if(result["dps"].is<JsonObject>())return true;lastError="Tuya 3.4 respondeu sem DPs válidos.";return false;
  }
  client.stop();lastError="Tuya 3.4 não confirmou o pedido.";return false;
}
// One TCP send per request. Status may try device22 only after explicit rejection.
bool request(JsonObject d,bool writing,JsonVariantConst value,bool special,Doc& result,bool& device22){
  auto cfg=d["config"].as<JsonObject>();if(!tuyaValidate(cfg))return false;
  if(cfg["version"]=="3.4")return request34(d,writing,value,result);
  String key=cfg["local_key"],id=cfg["device_id"],dp=String(cfg["dp"]|1);
  Doc payload(4096);payload["devId"]=id;payload["uid"]=id;payload["t"]=String((unsigned long)time(nullptr));
  if(!writing&&!special)payload["gwId"]=id;
  uint32_t cmd=writing?7:special?13:10;
  if(writing)payload["dps"][dp]=value;
  else if(special){auto requested=payload.createNestedObject("dps");requested[dp]=nullptr;for(const char* field:{"position_dp","temperature_dp","target_temperature_dp","humidity_dp"})if(cfg[field].is<int>()&&cfg[field].as<int>()>0)requested[String(cfg[field].as<int>())]=nullptr;}
  String text;serializeJson(payload,text);size_t len=(text.length()/16+1)*16;
  std::vector<uint8_t> body(len,(uint8_t)(len-text.length()));memcpy(body.data(),text.c_str(),text.length());
  if(!crypt(body,(const uint8_t*)key.c_str(),false)){lastError="Não foi possível criptografar Tuya.";return false;}
  if(cmd!=10){std::vector<uint8_t> version(15,0);memcpy(version.data(),"3.3",3);body.insert(body.begin(),version.begin(),version.end());}
  std::vector<uint8_t> packet;put(packet,0x55aa);put(packet,sequence++);put(packet,cmd);put(packet,body.size()+8);packet.insert(packet.end(),body.begin(),body.end());put(packet,crc(packet.data(),packet.size()));put(packet,0xaa55);
  IPAddress ip;if(!localIP(cfg["ip"]|"",ip)){lastError="Aguardando identificação do aparelho no Wi-Fi.";return false;}WiFiClient client;
  if(!client.connect(ip,cfg["port"]|6668,1800)){lastError="Tuya sem conexão TCP. Confira IP e Wi-Fi.";return false;}
  if(client.write(packet.data(),packet.size())!=packet.size()){client.stop();lastError="Envio Tuya incompleto; não repita automaticamente.";return false;}
  uint32_t until=millis()+3000;
  for(int frames=0;frames<8&&(int32_t)(until-millis())>0;frames++){
    uint8_t header[16];if(!readExact(client,header,16,until))break;
    uint32_t n=word(header+12),command=word(header+8);
    if(word(header)!=0x55aa||n<12||n>LIMIT){client.stop();lastError="Pacote Tuya inválido.";return false;}
    std::vector<uint8_t> tail(n);if(!readExact(client,tail.data(),n,until))break;
    std::vector<uint8_t> check(header,header+16);check.insert(check.end(),tail.begin(),tail.end()-8);
    if(word(tail.data()+n-4)!=0xaa55||word(tail.data()+n-8)!=crc(check.data(),check.size())){client.stop();lastError="Resposta Tuya com integridade inválida.";return false;}
    if(word(tail.data())!=0){client.stop();lastError="Tuya recusou o pedido. Confira a local key.";return false;}
    if(command!=cmd&&command!=8)continue;
    if(n==12){if(writing){client.stop();return true;}continue;}
    std::vector<uint8_t> encrypted(tail.begin()+4,tail.end()-8);
    if(!decode(encrypted,(const uint8_t*)key.c_str(),result,device22)){client.stop();lastError="Não foi possível validar a resposta Tuya. Confira a local key.";return false;}
    client.stop();
    if(device22&&!writing){lastError="Tuya exige consulta device22.";return false;}
    if(result["dps"].is<JsonObject>())return true;
    lastError="Tuya respondeu sem estado válido.";return false;
  }
  client.stop();lastError=writing?"Tuya não confirmou o comando. Confira o aparelho antes de repetir.":"Tuya não retornou o estado. Confira a local key e o DP.";return false;
}
bool poll(JsonObject d,Doc& result){bool special=false;bool ok=request(d,false,JsonVariantConst(),false,result,special);if(!ok&&special){result.clear();special=false;return request(d,false,JsonVariantConst(),true,result,special);}return ok;}
}
bool tuyaValidate(JsonObject cfg){
  IPAddress ip;String key=cfg["local_key"]|"",id=cfg["device_id"]|"",version=cfg["version"]|"3.3";int dp=cfg["dp"]|1,port=cfg["port"]|6668;
  bool unresolved=cfg["auto_discover"]==true&&!String(cfg["ip"]|"").length();
  if((!localIP(cfg["ip"]|"",ip)&&!unresolved)||id.length()<16||id.length()>40||key.length()!=16||dp<1||dp>255||port<1||port>65535){lastError="Confira IP privado, device ID, local key de 16 caracteres e DP Tuya.";return false;}
  for(char c:id)if(!isalnum((unsigned char)c)){lastError="Device ID Tuya inválido.";return false;}
  if(version!="3.3"&&version!="3.4"){lastError="A central suporta Tuya 3.3 e 3.4 nesta versão.";return false;}
  for(const char* field:{"position_dp","temperature_dp","target_temperature_dp","humidity_dp"})if(cfg.containsKey(field)){int n=cfg[field]|0;if(n<1||n>255){lastError="DP opcional Tuya inválido.";return false;}}
  int type=cfg["cover_type"]|1;if(type<1||type>8){lastError="Confira o tipo da cortina (1 a 8).";return false;}
  for(const char* field:{"temperature_divisor","humidity_divisor"})if(cfg.containsKey(field)&&(!isfinite(cfg[field].as<float>())||cfg[field].as<float>()<=0)){lastError="O divisor de leitura deve ser positivo.";return false;}return true;
}
bool tuyaSend(JsonObject d,const String& action){
  Doc data(128);auto value=data.to<JsonObject>();
  if((d["kind"]=="switch"||d["kind"]=="light")&&(action=="on"||action=="off"))value["value"]=action=="on";
  else if(d["kind"]=="cover"&&(action=="open"||action=="close"||action=="stop")){
    int type=d["config"]["cover_type"]|1;int index=action=="open"?0:action=="close"?1:2;
    const char* codes[][3]={{"open","close","stop"},{nullptr,nullptr,nullptr},{"1","2","0"},{"01","02","00"},{"fopen","fclose",nullptr},{"on","off","stop"},{"up","down","stop"},{"ZZ","FZ","STOP"}};
    if(type<1||type>8||(index==2&&(type==2||type==5))){lastError="Esta configuração de cortina não oferece esse comando.";return false;}
    if(type==2)value["value"]=index==0;else value["value"]=codes[type-1][index];
  }else{lastError="Comando Tuya não permitido.";return false;}
  Doc result(16384);bool special=false;return request(d,true,value["value"],false,result,special);
}
void tuyaStatus(JsonObject d,JsonObject out){
  IPAddress ip;if(!localIP(d["config"]["ip"]|"",ip)){out["available"]=false;out["state"]="unavailable";out["message"]="Chave salva. Aguardando anúncio do aparelho no Wi-Fi para identificar IP e protocolo.";return;}
  Doc result(16384);bool ok=poll(d,result);out["available"]=ok;out["state"]=ok?"unknown":"unavailable";out["state_source"]="Tuya "+String(d["config"]["version"]|"3.3")+" · rede local";
  if(!ok){out["message"]=lastError;return;}
  auto cfg=d["config"].as<JsonObject>(),dps=result["dps"].as<JsonObject>();auto value=dps[String(cfg["dp"]|1)];
  if((d["kind"]=="switch"||d["kind"]=="light")&&value.is<bool>())out["state"]=value.as<bool>()?"on":"off";
  if(d["kind"]=="sensor")out["state"]="online";
  auto telemetry=out.createNestedObject("telemetry");
  if(d["kind"]=="cover"){
    if(cfg["position_dp"].is<int>()){
      auto position=dps[String(cfg["position_dp"].as<int>())];if(position.is<int>()&&position.as<int>()>=0&&position.as<int>()<=100){int n=position.as<int>();telemetry["position_percent"]=n;out["state"]=n==0?"closed":n==100?"open":"partial";}
    }
    // Movement enum describes a command, not a confirmed end position.
    if(value.is<const char*>())telemetry["movement"]=value;
  }
  const char* fields[][2]={{"temperature_dp","temperature"},{"target_temperature_dp","target_temperature"}};
  for(auto& f:fields)if(cfg[f[0]].is<int>()){auto n=dps[String(cfg[f[0]].as<int>())];if(n.is<float>()||n.is<int>()){float value=n.as<float>()/(cfg["temperature_divisor"]|1.0f);if(isfinite(value)&&value>=-100&&value<=200)telemetry[f[1]]=value;}}
  if(cfg["humidity_dp"].is<int>()){auto n=dps[String(cfg["humidity_dp"].as<int>())];if(n.is<float>()||n.is<int>()){float value=n.as<float>()/(cfg["humidity_divisor"]|1.0f);if(isfinite(value)&&value>=0&&value<=100)telemetry["humidity_percent"]=value;}}
  if(telemetry.containsKey("temperature")||telemetry.containsKey("target_temperature"))telemetry["temperature_unit"]=cfg["temperature_unit"]|"°C";
  out["message"]=d["kind"]=="cover"?"Estado consultado no aparelho. Movimento da cortina não confirma posição final.":d["kind"]=="sensor"?"Leituras consultadas no sensor pelos DPs configurados.":"Estado consultado no aparelho.";
}
void tuyaLoop(){
  if(!listening){listening=udpPlain.begin(6666)&&udpEncrypted.begin(6667)&&udpModern.begin(7000);if(!listening){udpPlain.stop();udpEncrypted.stop();udpModern.stop();return;}}
  uint8_t key[16];mbedtls_md5_ret((const uint8_t*)"yGAdlopoPVldABfn",16,key);
  for(auto udp:{&udpPlain,&udpEncrypted,&udpModern})for(int frames=0;frames<8;frames++){
    int n=udp->parsePacket();if(n<=0)break;IPAddress ip=udp->remoteIP(),checked;
    if(n<28||n>(int)LIMIT||!localIP(ip.toString(),checked)){while(udp->available())udp->read();continue;}
    std::vector<uint8_t> packet(n),body;if(udp->read(packet.data(),n)!=n)continue;Doc data(16384);bool modern=word(packet.data())==0x6699;
    if(modern){if(!modernPacket(packet,key,body))continue;}
    else {if(word(packet.data())!=0x55aa||word(packet.data()+12)!=(uint32_t)n-16||word(packet.data()+n-4)!=0xaa55||word(packet.data()+n-8)!=crc(packet.data(),n-8))continue;body.assign(packet.begin()+20,packet.end()-8);}
    if(body.empty())continue;bool ok=false;if(body[0]=='{')ok=!deserializeJson(data,body.data(),body.size());else if(crypt(body,key,true))ok=!deserializeJson(data,body.data(),body.size());
    String id=data["gwId"]|"",version=data["version"]|"";if(!ok||id.length()<16||id.length()>40)continue;
    if(discoveries.size()>=32&&!discoveries.count(id))discoveries.erase(discoveries.begin());discoveries[id]={ip.toString(),version,millis()};
    if(version=="3.3"||version=="3.4")for(auto d:house["devices"].as<JsonArray>())if(d["adapter"]=="tuya"&&d["config"]["auto_discover"]==true&&d["config"]["device_id"]==id){
      auto cfg=d["config"].as<JsonObject>();if(cfg["ip"]!=ip.toString()||cfg["version"]!=version){cfg["ip"]=ip.toString();cfg["version"]=version;saveHouse();}
    }
  }
}
void tuyaDiscover(JsonArray output){
  tuyaLoop();if(!listening){lastError="Não foi possível escutar anúncios Tuya.";return;}discoveryProbe();uint32_t until=millis()+12000;
  while((int32_t)(until-millis())>0){tuyaLoop();delay(3);}
  for(auto& pair:discoveries){if(millis()-pair.second.seen>60000)continue;auto item=output.createNestedObject();item["device_id"]=pair.first;item["ip"]=pair.second.ip;item["version"]=pair.second.version;item["port"]=6668;item["supported"]=pair.second.version=="3.3"||pair.second.version=="3.4";item["needs_local_key"]=true;}
}
