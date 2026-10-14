#include "common.h"
#include "sonoff.h"
#include "tuya.h"
#include <WiFiUdp.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <NimBLEDevice.h>
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>
#include <mbedtls/sha256.h>

bool localIP(const String& value,IPAddress& ip) {
  if(!ip.fromString(value))return false;
  return ip[0]==10||(ip[0]==172&&ip[1]>=16&&ip[1]<=31)||(ip[0]==192&&ip[1]==168);
}
String randomToken(size_t bytes) {
  String s;for(size_t i=0;i<bytes;i++){char x[3];snprintf(x,sizeof(x),"%02x",(uint8_t)esp_random());s+=x;}return s;
}
String base64(const uint8_t* p,size_t n) {
  size_t out=0;std::vector<uint8_t> b((n+2)/3*4+1);if(mbedtls_base64_encode(b.data(),b.size(),&out,p,n))return "";return String((char*)b.data(),out);
}
std::vector<uint8_t> unbase64(const String& text) {
  std::vector<uint8_t> b(text.length()*3/4+4);size_t n=0;
  if(text.length()>6000||mbedtls_base64_decode(b.data(),b.size(),&n,(const uint8_t*)text.c_str(),text.length()))return {};
  b.resize(n);return b;
}
static bool parseHex(String s,uint8_t* b,size_t n) {
  s.replace(":","");s.replace("-","");if(s.length()!=n*2)return false;
  for(size_t i=0;i<n;i++){char a=s[2*i],c=s[2*i+1];if(!isxdigit(a)||!isxdigit(c))return false;b[i]=strtoul(s.substring(i*2,i*2+2).c_str(),nullptr,16);}return true;
}
static uint16_t sum16(const uint8_t* p,size_t n) { uint32_t s=0xbeaf;for(size_t i=0;i<n;i++)s+=p[i];return s&0xffff; }
static void put16(uint8_t* p,uint16_t n){p[0]=n&255;p[1]=n>>8;}
static uint16_t get16(const uint8_t* p){return p[0]|(p[1]<<8);}
static uint8_t blKey[16],blId[4];static String blIdentity;static uint16_t blCount=0x8000,blDeviceError=0;
static const uint8_t initialKey[]={0x09,0x76,0x28,0x34,0x3f,0xe9,0x9e,0x23,0x76,0x5c,0x15,0x13,0xac,0xcf,0x8b,0x02};
static const uint8_t initialIV[]={0x56,0x2e,0x17,0x99,0x6d,0x09,0x3d,0x28,0xdd,0xb3,0xba,0x69,0x5a,0x2e,0x6f,0x58};
static bool blPacket(JsonObject cfg,uint16_t type,const std::vector<uint8_t>& raw,std::vector<uint8_t>& output) {
  blDeviceError=0;
  IPAddress ip;uint8_t mac[6];if(!localIP(cfg["ip"]|"",ip)||!parseHex(cfg["mac"]|"",mac,6)){lastError="Configure IP e MAC locais do BroadLink.";return false;}
  std::vector<uint8_t> padded=raw;padded.resize((raw.size()+15)/16*16,0);std::vector<uint8_t> packet(56+padded.size(),0);
  const uint8_t header[]={0x5a,0xa5,0xaa,0x55,0x5a,0xa5,0xaa,0x55};memcpy(packet.data(),header,8);
  put16(packet.data()+0x24,cfg["devtype"].as<uint16_t>());put16(packet.data()+0x26,type);put16(packet.data()+0x28,++blCount|0x8000);
  for(int i=0;i<6;i++)packet[0x2a+i]=mac[5-i];memcpy(packet.data()+0x30,blId,4);put16(packet.data()+0x34,sum16(padded.data(),padded.size()));
  mbedtls_aes_context aes;mbedtls_aes_init(&aes);uint8_t iv[16];memcpy(iv,initialIV,16);
  mbedtls_aes_setkey_enc(&aes,blKey,128);int rc=mbedtls_aes_crypt_cbc(&aes,MBEDTLS_AES_ENCRYPT,padded.size(),iv,padded.data(),packet.data()+56);mbedtls_aes_free(&aes);if(rc)return false;
  put16(packet.data()+0x20,sum16(packet.data(),packet.size()));WiFiUDP udp;if(!udp.begin(0)){lastError="UDP indisponível.";return false;}
  // Never retry an actuator packet: a toggle received twice could reverse its result.
  udp.beginPacket(ip,80);udp.write(packet.data(),packet.size());udp.endPacket();uint32_t deadline=millis()+1600;
  while((int32_t)(deadline-millis())>0){int n=udp.parsePacket();if(n){if(udp.remoteIP()!=ip||udp.remotePort()!=80||n<56||n>8192){while(udp.available())udp.read();continue;}
    std::vector<uint8_t> response(n);udp.read(response.data(),n);uint16_t expected=get16(response.data()+0x20);response[0x20]=response[0x21]=0;
    if(sum16(response.data(),n)!=expected||get16(response.data()+0x28)!=(uint16_t)(blCount|0x8000))continue;
    if(get16(response.data()+0x22)){blDeviceError=get16(response.data()+0x22);lastError="BroadLink recusou a solicitação.";udp.stop();return false;}
    size_t len=n-56;if(len%16){lastError="Resposta BroadLink inválida.";udp.stop();return false;}output.resize(len);memcpy(iv,initialIV,16);mbedtls_aes_init(&aes);mbedtls_aes_setkey_dec(&aes,blKey,128);
    rc=mbedtls_aes_crypt_cbc(&aes,MBEDTLS_AES_DECRYPT,len,iv,response.data()+56,output.data());mbedtls_aes_free(&aes);udp.stop();if(rc||sum16(output.data(),output.size())!=get16(response.data()+0x34)){lastError="Resposta BroadLink com integridade inválida.";blIdentity="";return false;}return true;
  }delay(2);}udp.stop();lastError="BroadLink não respondeu; o envio não confirma a reação do aparelho.";return false;
}
bool broadlinkAuth(JsonObject cfg,bool refresh) {
  String identity=String(cfg["ip"]|"")+"/"+String(cfg["mac"]|"");
  if(!refresh&&identity==blIdentity)return true;blIdentity="";memcpy(blKey,initialKey,16);memset(blId,0,4);std::vector<uint8_t> raw(80,0),out;
  memset(raw.data()+4,0x31,16);raw[0x1e]=raw[0x2d]=1;memcpy(raw.data()+0x30,"Test 1",6);
  if(!blPacket(cfg,0x65,raw,out)||out.size()<20)return false;memcpy(blId,out.data(),4);memcpy(blKey,out.data()+4,16);blIdentity=identity;return true;
}
bool broadlinkSupportsRF(JsonObject cfg){int type=cfg["devtype"]|0;for(int id:{0x2712,0x272a,0x273d,0x277c,0x2783,0x2787,0x278b,0x2797,0x279d,0x27a1,0x27a6,0x27a9,0x27c3})if(type==id)return true;return false;}
bool broadlinkSend(JsonObject cfg,const String& code) {
  auto data=unbase64(code);if(data.size()<6||data.size()>4096||(data[0]!=0x26&&!((data[0]==0xb2||data[0]==0xd7)&&broadlinkSupportsRF(cfg)))){lastError="Sinal IR/RF inválido ou RF não suportado neste BroadLink.";return false;}if(!broadlinkAuth(cfg))return false;
  std::vector<uint8_t> raw(4,0),out;raw[0]=2;raw.insert(raw.end(),data.begin(),data.end());return blPacket(cfg,0x6a,raw,out);
}
bool broadlinkLearn(JsonObject cfg,String& code) {
  if(!broadlinkAuth(cfg))return false;std::vector<uint8_t> raw(4,0),out;raw[0]=3;if(!blPacket(cfg,0x6a,raw,out))return false;
  uint32_t deadline=millis()+25000;raw[0]=4;
  while((int32_t)(deadline-millis())>0){delay(500);if(blPacket(cfg,0x6a,raw,out)&&out.size()>10&&out[4]==0x26){size_t len=out[6]|(out[7]<<8);len+=8;if(len>out.size()-4)len=out.size()-4;if(len>4096)break;code=base64(out.data()+4,len);return true;}yield();}
  lastError="Nenhum sinal IR recebido. Aponte o controle físico para o BroadLink.";return false;
}
bool broadlinkStartLearning(JsonObject cfg,const String& transport){
  if(transport!="ir"&&transport!="rf"){lastError="Escolha IR ou RF.";return false;}
  if(transport=="rf"&&!broadlinkSupportsRF(cfg)){lastError="RF requer um RM pro/pro+ compatível.";return false;}
  if(!broadlinkAuth(cfg))return false;std::vector<uint8_t> raw(4,0),out;raw[0]=transport=="rf"&&(cfg["devtype"]|0)!=0x2712?0x19:3;return blPacket(cfg,0x6a,raw,out);
}
int broadlinkPollLearning(JsonObject cfg,const String& transport,String& stage,String& code){
  if(!broadlinkAuth(cfg))return -1;std::vector<uint8_t> raw(4,0),out;
  if(transport=="rf"&&stage=="frequency"){
    raw[0]=0x1a;if(!blPacket(cfg,0x6a,raw,out))return -1;
    if(out.size()<5){lastError="Resposta de frequência inválida.";return -1;}
    if(!out[4])return 0;
    raw[0]=0x1b;if(!blPacket(cfg,0x6a,raw,out))return -1;stage="packet";return 0;
  }
  raw[0]=4;if(!blPacket(cfg,0x6a,raw,out)){if(blDeviceError==0xfff6||blDeviceError==0xfffb){lastError="";return 0;}return -1;}
  if(out.size()<10)return 0;uint8_t prefix=out[4];bool expected=transport=="ir"?prefix==0x26:(prefix==0xb2||prefix==0xd7);
  if(!expected)return 0;size_t n=(out[6]|(out[7]<<8))+4;if(n<6||n>4096||n>out.size()-4){lastError="Sinal recebido com tamanho inválido.";return -1;}
  code=base64(out.data()+4,n);return 1;
}
void broadlinkCancelLearning(JsonObject cfg,const String& transport){if(transport!="rf"||(cfg["devtype"]|0)==0x2712)return;std::vector<uint8_t> raw(4,0),out;raw[0]=0x1e;blPacket(cfg,0x6a,raw,out);}

// Samsung TLS is accepted only after comparing the exact device certificate hash,
// before any HTTP request, saved authorization token or WebSocket data is sent.
static WiFiClientSecure tvTLS;static bool tvOpen=false,tvReady=false;static String tvId;static std::vector<uint8_t> wsBuffer;
static bool wsSend(uint8_t op,const String& value) {
  if(!tvOpen||!tvTLS.connected()||value.length()>4096)return false;uint8_t header[14],mask[4];size_t n=0;header[n++]=0x80|op;
  if(value.length()<126)header[n++]=0x80|value.length();else{header[n++]=0x80|126;header[n++]=value.length()>>8;header[n++]=value.length()&255;}
  esp_fill_random(mask,4);memcpy(header+n,mask,4);n+=4;std::vector<uint8_t> payload(value.length());for(size_t i=0;i<value.length();i++)payload[i]=value[i]^mask[i%4];
  return tvTLS.write(header,n)==n&&tvTLS.write(payload.data(),payload.size())==payload.size();
}
void samsungLoop() {
  if(!tvOpen)return;if(!tvTLS.connected()){tvOpen=tvReady=false;return;}
  while(tvTLS.available()&&wsBuffer.size()<65536)wsBuffer.push_back(tvTLS.read());
  while(wsBuffer.size()>=2){uint8_t op=wsBuffer[0]&15;uint64_t len=wsBuffer[1]&127;size_t pos=2;if(wsBuffer[1]&128){tvTLS.stop();tvOpen=tvReady=false;break;}
    if(len==126){if(wsBuffer.size()<4)break;len=(wsBuffer[2]<<8)|wsBuffer[3];pos=4;}else if(len==127){if(wsBuffer.size()<10)break;len=0;for(int i=2;i<10;i++)len=(len<<8)|wsBuffer[i];pos=10;}
    if(len>32768||!(wsBuffer[0]&0x80)){tvTLS.stop();tvOpen=tvReady=false;break;}if(wsBuffer.size()<pos+len)break;
    String text((char*)wsBuffer.data()+pos,len);
    if(op==1){Doc doc(65536);if(!deserializeJson(doc,text)){String event=doc["event"]|"";if(event=="ms.channel.connect"){tvReady=true;String token=doc["data"]["token"]|"";if(token.length()&&token.length()<200){auto d=deviceById(tvId);d["config"]["token"]=token;saveHouse();}}else if(event=="ms.channel.unauthorized"){lastError="Autorize Casa Universal na TV.";tvTLS.stop();tvOpen=tvReady=false;}}}
    else if(op==9)wsSend(10,text);else if(op==8){tvTLS.stop();tvOpen=tvReady=false;}
    wsBuffer.erase(wsBuffer.begin(),wsBuffer.begin()+pos+len);
  }
}
bool samsungPair(JsonObject device) {
  if(tvReady&&tvTLS.connected()&&tvId==device["id"].as<String>())return true;
  IPAddress ip;auto cfg=device["config"].as<JsonObject>();uint8_t expected[32],got[32];
  if(!localIP(cfg["ip"]|"",ip)||!parseHex(cfg["tls_pin"]|"",expected,32)){lastError="Importe pelo USB a identidade TLS desta TV antes de parear.";return false;}
  tvTLS.stop();tvOpen=tvReady=false;tvTLS.setInsecure();tvTLS.setTimeout(3000);tvTLS.setHandshakeTimeout(5);
  if(!tvTLS.connect(ip,cfg["port"]|8002)||!tvTLS.getFingerprintSHA256(got)){lastError="TV sem conexão TLS.";tvTLS.stop();return false;}
  uint8_t mismatch=0;for(int i=0;i<32;i++)mismatch|=expected[i]^got[i];if(mismatch){tvTLS.stop();lastError="A identidade TLS da TV mudou. Revalide pelo USB.";return false;}
  String path="/api/v2/channels/samsung.remote.control?name="+base64((const uint8_t*)"Casa Universal",14);String token=cfg["token"]|"";if(token.length())path+="&token="+token;
  uint8_t nonce[16];esp_fill_random(nonce,16);String wsKey=base64(nonce,16);String acceptInput=wsKey+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";uint8_t hash[20];mbedtls_sha1_ret((const uint8_t*)acceptInput.c_str(),acceptInput.length(),hash);String expectedAccept=base64(hash,20);
  tvTLS.print("GET "+path+" HTTP/1.1\r\nHost: "+ip.toString()+":8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+wsKey+"\r\nSec-WebSocket-Version: 13\r\n\r\n");
  String headers;uint32_t deadline=millis()+5000;while(!headers.endsWith("\r\n\r\n")&&(int32_t)(deadline-millis())>0&&headers.length()<8192){while(tvTLS.available()&&!headers.endsWith("\r\n\r\n"))headers+=(char)tvTLS.read();delay(1);}
  if(!headers.startsWith("HTTP/1.1 101")||headers.indexOf(expectedAccept)<0){tvTLS.stop();lastError="TV recusou a conexão de controle.";return false;}
  tvId=device["id"].as<String>();tvOpen=true;wsBuffer.clear();deadline=millis()+35000;
  while(tvOpen&&!tvReady&&(int32_t)(deadline-millis())>0){samsungLoop();delay(5);}if(!tvReady){lastError="Autorize Casa Universal na TV e tente novamente.";tvTLS.stop();tvOpen=false;}return tvReady;
}
bool samsungSend(JsonObject d,const String& action,Doc* result) {
  const char* pairs[][2]={{"power","KEY_POWER"},{"up","KEY_UP"},{"down","KEY_DOWN"},{"left","KEY_LEFT"},{"right","KEY_RIGHT"},{"enter","KEY_ENTER"},{"back","KEY_RETURN"},{"home","KEY_HOME"},{"volume_up","KEY_VOLUP"},{"volume_down","KEY_VOLDOWN"},{"mute","KEY_MUTE"},{"channel_up","KEY_CHUP"},{"channel_down","KEY_CHDOWN"},{"source","KEY_SOURCE"},{"play","KEY_PLAY"},{"pause","KEY_PAUSE"}};
  String energyKey;
  if(action=="power_on"||action=="power_off"){
    String state;bool reachable=samsungStatus(d,state);
    if((action=="power_on"&&state=="on")||(action=="power_off"&&(state=="off"||state=="standby"))){
      if(result){(*result)["sent"]=false;(*result)["already_in_state"]=true;(*result)["message"]="A TV já informa o estado solicitado. Nenhum botão foi enviado.";}return true;
    }
    if(reachable){
      if(state!="on"&&state!="off"&&state!="standby"){lastError="A TV não confirmou a energia. Use Liga / desliga somente após conferir a tela.";return false;}
      energyKey="KEY_POWER"; // Verified on DU8000: POWEROFF is ignored; POWER also wakes standby.
    }else if(action=="power_off"){lastError="TV sem resposta. Não foi enviado um botão que poderia ligar a TV.";return false;}
    else{
      uint8_t mac[6];if(!parseHex(d["config"]["mac"]|"",mac,6)){lastError="Configure o MAC da TV para Wake-on-LAN.";return false;}
      uint8_t magic[102];memset(magic,255,6);for(int i=0;i<16;i++)memcpy(magic+6+i*6,mac,6);
      WiFiUDP udp;if(!udp.begin(0)){lastError="Não foi possível preparar Wake-on-LAN.";return false;}
      IPAddress broadcast;auto ip=WiFi.localIP(),mask=WiFi.subnetMask();for(int i=0;i<4;i++)broadcast[i]=ip[i]|((uint8_t)~mask[i]);
      bool sent=false;for(int port:{7,9}){if(udp.beginPacket(broadcast,port)&&udp.write(magic,102)==102&&udp.endPacket())sent=true;}udp.stop();
      if(!sent){lastError="Wake-on-LAN não foi enviado.";return false;}
      if(result)(*result)["message"]="Wake-on-LAN enviado. Se não ligar, ative Ligar com dispositivo móvel na TV e confira a mesma rede Wi-Fi.";return true;
    }
  }
  String key=energyKey;for(auto& pair:pairs)if(action==pair[0])key=pair[1];if(!key.length()){lastError="Comando não permitido.";return false;}if(!samsungPair(d))return false;
  Doc command(1024);command["method"]="ms.remote.control";auto p=command.createNestedObject("params");p["Cmd"]="Click";p["DataOfCmd"]=key;p["Option"]="false";p["TypeOfRemote"]="SendRemoteKey";String text;serializeJson(command,text);return wsSend(1,text);
}
bool samsungStatus(JsonObject d,String& state) {
  IPAddress ip;if(!localIP(d["config"]["ip"]|"",ip))return false;WiFiClient client;HTTPClient http;http.setTimeout(1600);http.setConnectTimeout(1600);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.begin(client,"http://"+ip.toString()+":8001/api/v2/");int status=http.GET();if(status!=200||http.getSize()>65536){http.end();return false;}Doc doc(65536);auto err=deserializeJson(doc,http.getStream());http.end();if(err)return false;
  String power=doc["device"]["PowerState"]|"unknown";state=(power=="on"||power=="off"||power=="standby")?power:"unknown";return true;
}

void discoverDevices(const String& provider,JsonArray output) {
  if(provider=="tuya") {tuyaDiscover(output);return;}
  if(provider=="bluetooth"){
    static bool initialized=false;if(!initialized){NimBLEDevice::init("Casa Universal");initialized=true;}auto scan=NimBLEDevice::getScan();scan->setActiveScan(true);scan->setInterval(120);scan->setWindow(60);
    auto results=scan->start(5,false);for(int i=0;i<results.getCount()&&i<64;i++){auto d=results.getDevice(i);auto item=output.createNestedObject();item["id"]=d.getAddress().toString();item["name"]=d.getName();item["rssi"]=d.getRSSI();item["likely_lock"]=d.getName().find("Lck")!=std::string::npos;auto services=item.createNestedArray("services");for(int j=0;j<d.getServiceUUIDCount();j++)services.add(d.getServiceUUID(j).toString());}scan->clearResults();return;
  }
  if(provider=="sonoff") {sonoffDiscover(output);return;}
  if(provider=="samsung") {
    std::vector<String> ips;auto configured=deviceById("tv");if(configured["adapter"]=="samsung")ips.push_back(configured["config"]["ip"].as<String>());
    WiFiUDP udp;udp.begin(0);String msg="M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: urn:samsung.com:device:RemoteControlReceiver:1\r\n\r\n";udp.beginPacket(IPAddress(239,255,255,250),1900);udp.print(msg);udp.endPacket();uint32_t deadline=millis()+1800;
    while((int32_t)(deadline-millis())>0){int n=udp.parsePacket();if(n){String ip=udp.remoteIP().toString();IPAddress checked;if(localIP(ip,checked)&&std::find(ips.begin(),ips.end(),ip)==ips.end()&&ips.size()<16)ips.push_back(ip);while(udp.available())udp.read();}delay(5);}udp.stop();
    for(auto ip:ips){WiFiClient client;HTTPClient http;http.setTimeout(1200);http.setConnectTimeout(1200);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);http.begin(client,"http://"+ip+":8001/api/v2/");if(http.GET()==200){Doc d(65536);if(!deserializeJson(d,http.getStream())&&String(d["device"]["type"]|"").indexOf("Samsung")>=0){auto o=output.createNestedObject();o["ip"]=ip;o["port"]=8002;o["name"]=d["device"]["name"]|"Samsung";o["model"]=d["device"]["modelName"]|"";o["mac"]=d["device"]["wifiMac"]|"";}}http.end();}return;
  }
  if(provider=="broadlink"){
    WiFiUDP udp;uint16_t port=40000+(esp_random()%20000);if(!udp.begin(port))return;uint8_t msg[48]={0};IPAddress local=WiFi.localIP();for(int i=0;i<4;i++)msg[0x18+i]=local[i];put16(msg+0x1c,port);msg[0x26]=6;put16(msg+0x20,sum16(msg,48));IPAddress bcast=local;bcast[3]=255;udp.beginPacket(bcast,80);udp.write(msg,48);udp.endPacket();uint32_t deadline=millis()+2000;
    while((int32_t)(deadline-millis())>0){int n=udp.parsePacket();if(n>=0x40&&n<=1024){uint8_t buf[1024];udp.read(buf,n);IPAddress check;if(localIP(udp.remoteIP().toString(),check)){auto o=output.createNestedObject();o["ip"]=check.toString();o["devtype"]=get16(buf+0x34);String mac;for(int i=5;i>=0;i--){char v[3];snprintf(v,3,"%02x",buf[0x3a+i]);mac+=v;}o["mac"]=mac;o["name"]="BroadLink";}}else while(udp.available())udp.read();delay(5);}udp.stop();return;
  }
  lastError="Provedor de descoberta desconhecido. Driver de fechadura ainda pendente.";
}
