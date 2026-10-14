// USB-only updates of public interface files; never touches controls/credentials.
#include "assets.h"
#include <LittleFS.h>
#include <mbedtls/sha256.h>

static File upload;
static String target,digest;
static size_t expected=0,offset=0;
static uint32_t deadline=0;
bool assetCommand(const String& op,JsonObject c,Doc& result){
  if(!op.startsWith("asset_"))return false;
  auto fail=[&](const char* message){upload.close();LittleFS.remove("/asset.new");target="";result["error"]=message;};
  if(op=="asset_begin"){
    upload.close();target="";String name=c["name"]|"";bool allowed=false;
    for(const char* asset:{"index.html","app.js", "visuals.js","style.css","sw.js","manifest.webmanifest","icon.svg","apple-touch-icon.png","icon-192.png","icon-512.png","templates.json","mcp-tools.json","catalog-index.json","profiles/climate_3000.json"})if(name==String(asset)+".gz")allowed=true;
    expected=c["size"]|0;digest=c["sha256"]|"";offset=0;
    if(!allowed||!expected||expected>131072||digest.length()!=64){fail("Arquivo de interface inválido.");return true;}
    for(char hex:digest)if(!isxdigit((unsigned char)hex)){fail("Digest inválido.");return true;}
    target="/"+name;upload=LittleFS.open("/asset.new","w");deadline=millis()+60000;
    if(!upload){fail("Não foi possível preparar a atualização.");return true;}
  }else{
    if(!upload||!target.length()||(int32_t)(deadline-millis())<=0){fail("Atualização USB expirada; recomece.");return true;}
    if(op=="asset_chunk"){
      auto data=unbase64(c["data"]|"");if(c["offset"].as<size_t>()!=offset||data.empty()||data.size()>2048||offset+data.size()>expected){fail("Bloco de interface inválido.");return true;}
      if(upload.write(data.data(),data.size())!=data.size()){fail("Gravação incompleta.");return true;}offset+=data.size();deadline=millis()+60000;
    }else if(op=="asset_finish"){
      upload.close();if(offset!=expected){fail("Arquivo incompleto; interface anterior preservada.");return true;}
      auto f=LittleFS.open("/asset.new","r");mbedtls_sha256_context hash;mbedtls_sha256_init(&hash);mbedtls_sha256_starts_ret(&hash,0);uint8_t buffer[1024],bytes[32];
      while(f.available()){size_t n=f.read(buffer,sizeof(buffer));mbedtls_sha256_update_ret(&hash,buffer,n);}f.close();mbedtls_sha256_finish_ret(&hash,bytes);mbedtls_sha256_free(&hash);
      String actual;for(auto b:bytes){char h[3];snprintf(h,3,"%02x",b);actual+=h;}if(actual!=digest){fail("Hash incorreto; interface anterior preservada.");return true;}
      // LittleFS rename replaces the previous file atomically.
      if(!LittleFS.rename("/asset.new",target)){fail("Falha ao confirmar a interface.");return true;}target="";
    }else{fail("Operação de interface desconhecida.");return true;}
  }
  result["ok"]=true;result["offset"]=offset;return true;
}
