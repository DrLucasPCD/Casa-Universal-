# Câmera da Echo: análise do aplicativo Alexa fornecido

Análise estática inicial realizada em 15/10/2026. Naquele levantamento não executamos o aplicativo nem iniciamos transmissão. Em 16/10/2026, a investigação prosseguiu com login autorizado e um receptor independente: **a imagem real da Echo chegou a 1280 × 720 no navegador**, sem acesso à câmera ou microfone do Mac. A [ponte Alexa](ponte-alexa.md) documenta a correção LiveView 2.2, a sinalização e o teste. O restante deste relatório preserva as evidências e limites do levantamento estático inicial.

## Resultado

O pacote contém uma implementação real de sessões de câmera com **LiveView, RTCSC e WebRTC**, incluindo um ramo de classificação de aparelhos Amazon (1P). Foi possível rastrear chamadas Java de início de sessão, envio de eventos pelo Alexa Mobile Framework, recebimento de sessão e sinalização de prontidão. Isso justifica investigar o caminho usado pelo aplicativo oficial, além do teste de câmera no navegador.

**Atualização de execução:** a ponte local recebeu vídeo da Echo em 16/10/2026. Não há URL RTSP reutilizável; o acesso depende de login e de uma sessão LiveView/RTC/WebRTC. Os caminhos abaixo foram inicialmente identificados por análise estática e não devem ser confundidos com um trace integral do app oficial em execução.

## Identidade e cobertura

Arquivo fornecido: `Amazon+Alexa_2.2.720364.0_APKPure.xapk`.

| Artefato | SHA-256 |
| --- | --- |
| XAPK fornecido | `71941b144dc9858227f84b1a04a131b95a8d80a88e2638e2b070c9a3f9af191a` |
| Base `com.amazon.dee.app.apk` | `27fb20d4a9c9ff1e40463afa5e3a2e627cd6380f6b240bae1427ef69e84d709f` |
| Split `config.arm64_v8a.apk` | `eef9ff5d51904f0d86cea900b8a926e96661577ffc621141066b5744d83c8979` |
| Hermes `assets/index.bundle.hbc` | `1719c1067553a2b656cc0d2f28c420117fc0a87b3ab6e41ceeff2f6754cb6aef` |

O manifesto preservado foi decodificado pelo REA: pacote `com.amazon.dee.app`, versão `2.2.720364.0`, código `965636405`. A autenticidade da assinatura Amazon não foi verificada; identidade declarada e hash não substituem essa verificação. O pacote contém 19 arquivos DEX, um split ARM64 e um split de densidade.

Ferramentas de código Android: **REA 6.4.0**, **jadx-headless-mcp 0.7.1**, JDK 21.0.12.1. O JAR corresponde ao SHA-256 `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`. Nenhum código Alexa foi executado.

A carga do APK completo excedeu o prazo de 120 segundos do provedor; uma inspeção de pacote também foi cancelada para evitar duplicar a carga. A análise prosseguiu com dois **contêineres derivados para análise**, contendo manifesto, recursos e, respectivamente, `classes18.dex` ou `classes5.dex`. Os membros selecionados são byte a byte idênticos aos do APK original. Não são aplicativos instaláveis autenticados e não foram executados.

| Contêiner derivado | SHA-256 | Membro de código preservado |
| --- | --- | --- |
| `alexa-camera-slice.apk` | `1db166a7c047e18e324f7ced86fdfa908e5c8f2a2a502007546b58d90c92c64e` | `classes18.dex`: `89004ea7e377e1eec4710f3e9ee928642324b69bade41b14875a9f086cfbd3b3` |
| `alexa-rtc-slice.apk` | `29b0edfee7093c385f8c0a11b7e730b51fbdb2e1087b0830300044ea5b331811` | `classes5.dex`, hash no registro de proveniência local |

Essa seleção limita referências entre DEX e a resolução de dependências. Foram produzidos 34 registros REA: 14 inspeções de classe, 18 de método, uma de pacote e uma de referências. A consulta de `<clinit>` do módulo LiveView não forneceu corpo. O método de registro do player retornou smali após falha de decompilação Java; isso não foi interpretado como execução ou bloqueio de segurança.

## Fluxo rastreado no código Android

Os nomes abaixo pertencem ao namespace `com.amazon.alexa.smarthomecameras`, salvo indicação contrária. Não incluímos código decompilado completo neste relatório público.

| Etapa | Observação estática | Registro REA local |
| --- | --- | --- |
| Solicitar sessão | `session.RtcscCameraSessionManager.requestSessionForDevice` constrói `RequestStartLiveViewContext`, define fabricante, alvos convertidos para endpoint Alexa e `SINGLEVIEW`, e chama `lvcEventSenderV2.sendEvent`. | `alexa-session-request.json` |
| Enviar evento | `eventsender.EventSender.sendEvent` entrega o evento construído a `amfApis.getCapabilitiesApi().sendEvent`. | `alexa-base-event-send.json` |
| Ponte React Native | `turbomodule.LiveViewControllerModule.sendAVSEvent` pré-aquece o player para `RequestStartLiveView`/`RequestPlaybackSession`, depois chama `AVSUtils`. | `alexa-module-sendavs.json` |
| Framework móvel | `turbomodule.AVSUtils.sendAVSEvent` inicia o Alexa Mobile Framework e envia cabeçalho e payload pela API de capacidades. Esse método não fornece uma URL HTTP independente. | `alexa-avsutils-send.json` |
| Diretiva de início | `directives.processor.StartLiveViewDirectiveProcessor.processDirective` lê payload com `sessionId` e envia `LiveViewStartedContext`. | `alexa-start-directive-process.json` |
| Sessão disponível | `session.RtcscCameraSessionManager.onSessionAvailable` associa `sessionId`, notifica listeners e chama `rtcscAppClient.signalReadyForSession`. | `alexa-session-available.json` |
| Registro do player | `rtcmediaplayer.RTCPlaybackManager.registerAppClientListener`, em smali, chama `RtcscAppClient.registerRtcscAppClientListener`. | `alexa-playback-register.json` |
| Serviço RTCSC | `com.amazon.rtcsc.appclient.RtcscAppClient.acceptSession` encaminha para o handler e exige que o cliente tenha sido registrado. | `alexa-rtc-accept.json` |
| Diretivas RTC | `com.amazon.rtcsc.capabilityagent.avs.RtcscCapabilityAgentServiceAVS.process` encaminha namespace, nome, ID, correlation token e payload a `processRTCDirective`. | `alexa-rtc-capability-process.json` |

Essa é uma cadeia de responsabilidades e chamadas identificadas. Ela não é um trace temporal de uma sessão real nem prova a sequência completa para todo modelo/caminho de interface do aplicativo.

### Evidências REA selecionadas

- Solicitação de sessão: `ev_6ad8b919a94b6a61870c9b15b1d9674ff03497bae02ebe01eaac2034d7dc64e0`.
- Envio pelo framework: `ev_a57a35d1d8d531671375b1d9e05934f206c74a2cec38080f133913a6bc85e38e`.
- Ponte LiveView: `ev_acbbcdd614ce63bc5916e364e8103c2d8f75f249c97588b7b44e940696fc827c`.
- Sessão disponível: `ev_49b77eacb0fbba784a7b6752909e376fc411684f6041d3208e3c48dd0c4156a2`.
- Diretivas RTC: `ev_500132cb6a9778a2091742b297f9a9a3fe8dddcc4639d03c58f8f27b41381f98`.

Os alvos desses registros são os contêineres derivados acima. A ligação com o APK fornecido está nos registros de proveniência dos membros, e não em uma alegação de análise integral bem-sucedida do APK.

## Hermes e bibliotecas nativas: análise complementar

Esta parte usou leitura de estruturas binárias e um decodificador estático local; **não é resultado do REA**. O formato foi consultado nas definições oficiais do [Hermes da Meta](https://github.com/facebook/hermes/tree/main/include/hermes/BCGen/HBC). O bundle é bytecode Hermes v96, não um arquivo JavaScript de texto.

- A tabela contém 599.342 strings; nenhuma entrada ficou fora dos limites calculados. Foram decodificadas 40 funções candidatas, dentre 316.925, sem erro de limite de instrução. Isso não equivale a reconstrução de fluxo de dados, grafo de controle ou alcançabilidade completa.
- Função 102279, intervalo `0x46c3130 + 760`: verifica `hasCapability(CapabilityInterfaces.RTCSessionController)`, distingue 1P/3P e consulta `ADselectors.getDeviceSetting(LiveViewKey)` com `deviceAccountId` no ramo 1P. A função 102298 apresenta lógica equivalente para o outro modelo de endpoints. Isso é uma evidência específica de tratamento de aparelhos Amazon, mas não identifica sozinho a câmera do usuário em execução.
- Função 206245, intervalo `0x57711ac + 612`: contém referências a resolução de DSN para endpoint, `listEndpoints` e `fetchEndpointById`. Nenhum DSN pessoal foi usado nessa análise.
- A ponte `NativeModules.NativeLiveViewController` é passada a `NativeEventEmitter`; listeners `onSessionsUpdated` e `onRequestStartLiveViewFailed` aparecem em instruções nos offsets `0x509c870` e `0x50a7d17`.
- `Alexa.HomeMonitoring` aparece como constante em um módulo de classificação/security. Sua coexistência com WebRTC não comprova, isoladamente, uma ligação de chamada. Os rótulos `appLiveViewCamerasTabEligibilityCheck1pAppliance` são métricas, não endpoints de conexão.
- Em ELF, **`librtcsc-jni.so` depende diretamente de `librtcmedia_webrtc_jni.so`**, via `DT_NEEDED`. A biblioteca de mídia define símbolos `WebRTCAndroidSession` para offer/answer SDP, ICE e restart ICE. A biblioteca RTCSC define bindings JNI para sessões e notificações de primeiro frame. Esse vínculo binário é mais forte que uma busca de strings, mas não observa negociação de rede.
- `libpjsua2.so` também está presente. Isso não prova que o Monitoramento residencial da Echo use SIP; não implementaremos um cliente SIP com base apenas nessa presença.

Hashes das bibliotecas: `librtcsc-jni.so` = `4377eedcb3bdd1afd364ba0ba5ef45ef7d2a1d6352b4c48a735525e6bdeff8d7`; `librtcmedia_webrtc_jni.so` = `8971bc92d8ceba4637e246b5add3e7293888462d493a8f3f5fcbead4c0fbcee2`.

## Autenticação: conclusão limitada

O envio de eventos e o recebimento de diretivas dependem do Alexa Mobile Framework. O XAPK distribuído fornece código; não contém a sessão autenticada que o usuário mantém no aplicativo do iPhone. A análise estática inicial, por si só, não estabeleceu a reprodução e renovação desse registro. A implementação e o teste posteriores estão documentados na ponte Alexa.

Investigamos `com.amazon.rtcsc.service.OAuthProviderImpl`: ele usa `MAPAccountManager`, `TokenManagement` e uma chave de token por pacote. Entretanto, `getAccessToken` implementa a interface OAuth do cliente **Minerva para métricas**, e a referência de entrada encontrada no recorte é `RtcscCustomMetricsPublisherAdapter`. **Não tratamos esse token como credencial do vídeo.** Nenhuma credencial pessoal foi extraída.

Evidências: `alexa-oauth-get-token.json` (`ev_adf1f74a8ccfc7b6751ac925d94f96bda7952119ca0642a6e6ba698333a27bb8`) e `alexa-oauth-references.json` (`ev_e71baa4e05b42bd11f2df469ba2572753556c3d751e55cfd7f1d87a17f88fe77`). A cobertura de referências é do recorte, não dos 19 DEX.

## O que falta para o Casa Universal

| Pergunta | Situação |
| --- | --- |
| O app fornecido tem infraestrutura de vídeo de câmera? | Respondida por código Android e vínculos nativos. |
| Existem tratamento 1P e configuração de Monitoramento residencial? | Evidências estáticas no Hermes; uso exato na Echo do usuário ainda não observado. |
| Como pede e associa uma sessão? | Parcialmente respondida: eventos LiveView, endpoint, sessão RTCSC e prontidão. |
| Como autenticar e registrar um cliente independente? | Login, registro e uso no teste real demonstrados pela ponte; renovação prolongada ainda a validar. |
| Como reproduzir a sinalização, SDP/ICE e obter frames da Echo? | Receptor DTLS/WebRTC implementado e testado no navegador com esta Echo, até 1280 × 720. |
| Gestos já funcionam? | Não. Falta vídeo contínuo, acesso aos frames, desempenho medido e calibração dos alvos. |

Esse marco foi alcançado em 16/10/2026: a ponte local descobriu a Echo, abriu a sessão e recebeu frames reais, depois encerrou o receptor e enviou `RequestStopLiveView`. As bibliotecas JNI Android dependem do ambiente Android; a integração web precisa de um cliente compatível ou de uma ponte que entregue o vídeo ao processador de gestos.

Com a recepção de vídeo validada nesta Echo, o reconhecimento de mãos ainda precisa rodar em um processador com desempenho medido. A central ESP32 continua responsável pelos comandos dos aparelhos; não foi implementado nela um decodificador de vídeo e reconhecimento de mãos. O Mac está disponível somente para testes, portanto a operação contínua ainda requer uma solução de processamento definida. O controle de cortina por percentual e a calibração dos gestos continuam pendentes conforme [o documento de gestos](gestos-echo-show.md).

## Evidência local e publicação

Os registros brutos estão em `research/evidence/`, ignorados pelo Git: `alexa-official-inventory.json`, `alexa-camera-slice-provenance.json`, `alexa-rtc-slice-provenance.json`, `alexa-official-evidence-index.json`, `alexa-bundle-summary.json` e os arquivos por operação listados acima. APKs, splits, bibliotecas e código decompilado não são publicados. Este relatório preserva observações e limites da análise estática. A ponte local e a validação posterior de vídeo são documentadas separadamente, sem publicar sessões, imagens privadas ou credenciais.
