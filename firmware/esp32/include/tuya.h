#pragma once
#include "common.h"
bool tuyaValidate(JsonObject cfg);
bool tuyaSend(JsonObject device,const String& action);
void tuyaStatus(JsonObject device,JsonObject output);
void tuyaDiscover(JsonArray output);
