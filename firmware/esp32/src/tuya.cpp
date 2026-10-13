// Tuya LAN 3.3 interoperability. Reference: TinyTuya 1.20.0 (MIT), see docs/tuya.md.
#include "tuya.h"
#include <WiFiUdp.h>
#include <mbedtls/aes.h>
#include <mbedtls/md5.h>
#include <time.h>
#include <set>
namespace {
constexpr size_t LIMIT=8192;
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
// One TCP send per request. Status may try device22 only after explicit rejection.
bool request(JsonObject d,bool writing,JsonVariantConst value,bool special,Doc& result,bool& device22){
  auto cfg=d["config"].as<JsonObject>();if(!tuyaValidate(cfg))return false;
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
  IPAddress ip;localIP(cfg["ip"]|"",ip);WiFiClient client;
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
  if(!localIP(cfg["ip"]|"",ip)||id.length()<16||id.length()>40||key.length()!=16||dp<1||dp>255||port<1||port>65535){lastError="Confira IP privado, device ID, local key de 16 caracteres e DP Tuya.";return false;}
  for(char c:id)if(!isalnum((unsigned char)c)){lastError="Device ID Tuya inválido.";return false;}
  if(version!="3.3"){lastError="A central suporta Tuya 3.3. Os seus aparelhos encontrados anunciam essa versão.";return false;}
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
  Doc result(16384);bool ok=poll(d,result);out["available"]=ok;out["state"]=ok?"unknown":"unavailable";out["state_source"]="Tuya 3.3 · rede local";
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
void tuyaDiscover(JsonArray output){
  WiFiUDP plain,encrypted;if(!plain.begin(6666)||!encrypted.begin(6667)){plain.stop();encrypted.stop();lastError="Não foi possível escutar anúncios Tuya.";return;}
  uint8_t key[16];mbedtls_md5_ret((const uint8_t*)"yGAdlopoPVldABfn",16,key);std::set<String> ids;uint32_t until=millis()+5500;
  while((int32_t)(until-millis())>0&&ids.size()<32){for(auto udp:{&plain,&encrypted}){
    int n=udp->parsePacket();if(n<=0)continue;IPAddress ip=udp->remoteIP(),checked;
    if(n<28||n>(int)LIMIT||!localIP(ip.toString(),checked)){while(udp->available())udp->read();continue;}
    std::vector<uint8_t> packet(n);if(udp->read(packet.data(),n)!=n||word(packet.data())!=0x55aa||word(packet.data()+12)!=(uint32_t)n-16||word(packet.data()+n-4)!=0xaa55||word(packet.data()+n-8)!=crc(packet.data(),n-8))continue;
    std::vector<uint8_t> body(packet.begin()+20,packet.end()-8);Doc data(16384);
    if(body.empty())continue;bool ok=false;if(body[0]=='{')ok=!deserializeJson(data,body.data(),body.size());else if(crypt(body,key,true))ok=!deserializeJson(data,body.data(),body.size());
    String id=data["gwId"]|"",version=data["version"]|"";if(!ok||id.length()<16||id.length()>40||ids.count(id))continue;
    ids.insert(id);auto item=output.createNestedObject();item["device_id"]=id;item["ip"]=ip.toString();item["version"]=version;item["port"]=6668;
    item["supported"]=version=="3.3";item["needs_local_key"]=true;
  }delay(3);}plain.stop();encrypted.stop();
}
