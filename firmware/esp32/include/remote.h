#pragma once
#include "common.h"
void remoteInit();
void remotePoll();
void remoteStatus(Doc& result);
bool remoteConfigure(JsonObject input);
bool runRemoteTool(const String& name,JsonObject args,Doc& result);
