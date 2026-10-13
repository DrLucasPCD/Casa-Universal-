#pragma once
#include "common.h"

// Stock eWeLink LAN protocol, adapted from AlexxIT/SonoffLAN (MIT).
bool sonoffValidate(JsonObject config, bool diy);
bool sonoffSend(JsonObject device, const String& action);
void sonoffStatus(JsonObject device, JsonObject output);
void sonoffDiscover(JsonArray output);
void sonoffLoop();
void sonoffForget(const String& id);
