#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>
#include <WiFi.h>
#include <vector>

struct PSAllocator {
  void* allocate(size_t n) { return heap_caps_malloc(n, MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT); }
  void deallocate(void* p) { heap_caps_free(p); }
  void* reallocate(void* p,size_t n) { return heap_caps_realloc(p,n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT); }
};
using Doc=BasicJsonDocument<PSAllocator>;
extern Doc house;
extern String lastError;
bool saveHouse();
JsonObject deviceById(const String& id);
String randomToken(size_t bytes=24);
bool localIP(const String& value, IPAddress& ip);
String base64(const uint8_t* data,size_t len);
std::vector<uint8_t> unbase64(const String& text);
bool broadlinkAuth(JsonObject config,bool refresh=false);
bool broadlinkSend(JsonObject config,const String& code);
bool broadlinkLearn(JsonObject config,String& code);
void samsungLoop();
bool samsungPair(JsonObject device);
bool samsungSend(JsonObject device,const String& action,Doc* result=nullptr);
bool samsungStatus(JsonObject device,String& state);
void discoverDevices(const String& provider,JsonArray output);
