# Ponte local Alexa — experimental

A ponte executa no Mac, separada do site Netlify e da central ESP32. O login manual já foi concluído em um teste pelo usuário. Ainda não foi demonstrado um canal LiveView autorizado, uma negociação WebRTC independente ou um frame da Echo. Os gestos não estão habilitados para acionar aparelhos.

## Executar

Com Node.js 22 ou mais recente, execute `npm ci` e `npm run alexa` na raiz do projeto. Abra http://127.0.0.1:8877/ no próprio Mac, selecione **Abrir login manual Amazon** e siga **Continuar login**. O formulário passa pelo intermediário local na porta 8878; a conexão dele com a Amazon usa HTTPS. Use a mesma conta do app Alexa.

O registro usa [alexa-cookie2 5.0.6](https://github.com/Apollon77/alexa-cookie), um cliente comunitário, e identifica o cliente como Casa Universal. Não é uma integração oficial Amazon nem exige que o usuário assine Alexa+ para abrir esse formulário. Isso não garante que a conta obtenha acesso ao vídeo.

Por padrão, tokens e cookies ficam apenas na memória do processo. Fechar ou reiniciar a ponte exige entrar novamente. A opção **Manter a conexão neste Mac** permite salvar a sessão em `data/alexa/registration.json`, com permissão 0600 e diretório 0700, para renovação no próximo início. A biblioteca também grava uma identidade de cliente em `data/alexa/device-identity.json`. A pasta é ignorada pelo Git. Senhas, tokens e cookies não são enviados ao Netlify ou Firestore; a ponte os usa somente com os serviços Amazon correspondentes. Os logs detalhados da biblioteca estão desativados.

## Verificar em etapas

1. **Login concluído** confirma o registro do cliente, sem comprovar vídeo.
2. **Buscar câmeras da conta** consulta os dispositivos e os endpoints pela sessão Amazon. O painel não publica números de série ou credenciais. Um resultado vazio ou uma consulta recusada precisa ser investigado antes de solicitar vídeo.
3. **Testar canal de vídeo** tenta o downchannel HTTP/2 no gateway escolhido. HTTP 200 com multipart válido confirma apenas o transporte de diretivas.
4. **Solicitar vídeo desta câmera** envia `RequestStartLiveView` ao endpoint descoberto. `StartLiveView` confirma uma sessão recebida; não significa que existem frames. A negociação WebRTC ainda precisa ser implementada/validada com as diretivas reais.
5. **Encerrar canal** envia `RequestStopLiveView` quando há um ID de sessão recebido e fecha a conexão local mesmo se esse envio falhar. Aceitação HTTP não é uma confirmação física de encerramento na Echo.

Os perfis atual e anterior usam gateways América identificados no código analisado. O perfil de notificações é somente um diagnóstico de autenticação; não se deve confundir uma conexão de notificações com vídeo. Não há URL RTSP inventada, extração da sessão do iPhone ou execução do APK.

## Protocolo e evidência

A [análise do app oficial](alexa-oficial.md) foi ampliada com um recorte de `classes15.dex` e `classes16.dex`, preservados byte a byte, SHA-256 do contêiner `75599c6f1b545424367efb7e10fc915239b02862903b1fb9a7ffc6460c08c98d`. A cobertura entre DEX continua parcial.

- Bearer real do transporte: `AuthorizationInterceptor` → `TokenProvider` → MAP por chave de pacote, distinto do cliente de métricas Minerva. Evidências REA `ev_3e803a59f87f04247f8704bca61f8e8c00b67824b65cfa0b662f2960daa6b6dd`, `ev_b429599cc6ab93f7ff6bf522fae445de9d2ce4fe862a765c64d63604331abb79` e `ev_98ae89a8d80eefee621ef806605699954da211beae514e8027d4a830b566f845`.
- Transporte: GET `/v20160207/directives` e POST `/v20160207/events`; o envio usa multipart/form-data com parte JSON `metadata`. Tanto a resposta ao evento quanto o downchannel podem conter diretivas. Evidências `ev_43d176090b327b337b88186bfc4beb2f5e54f274e323a96f412cb9b41a772f93`, `ev_5b03af19dfc02a39ea559926cbe56d7feef6d069079efabdc74b90ae559963a3` e `ev_1b182efa80e56516e487d2dc3fe2f0ae669818a64f3a43abb2eeff6a6d41a049`.
- O payload observado de `RequestStartLiveView` contém `sessionType`, `targets`, `requestId` e `deviceRequestStartTime`; a versão interna V2 não justifica inventar `payloadVersion: 2`.
- Os modelos RTC incluem troca DTLS/SDES, ICE, oferta e resposta SDP. A presença desses modelos não confirma a sequência negociada pela Echo do usuário.

O cliente independente usa o registro iOS comunitário e uma troca de token por pacote `com.amazon.echo`. A análise do Android não prova que esse registro obtenha as mesmas permissões de vídeo. Essa equivalência precisa de teste real, sem ampliar permissões ou substituir credenciais por valores fictícios.

## Gestos e limites atuais

`static/gesture-engine.js` implementa somente a geração de intenções: seleção explícita, permanência e confirmação, intervalo entre comandos, navegação por deslize e propostas limitadas de posição de cortina. A perda da mão ou a falta de frames desarma o alvo e propõe parar o arraste. O chamador deve fornecer observações reais e chamar `tick` periodicamente.

Não há reconhecimento de mãos conectado a essa biblioteca, calibração da sala, encaminhamento de gestos à central ou ferramenta MCP de gestos funcionando. O ajuste percentual da cortina também depende de validar um comando gravável no motor. O [plano de gestos](gestos-echo-show.md) descreve essas dependências. O ESP32 não executa o processamento de vídeo; o Mac está disponível somente durante os testes.

## Verificação

`npm test` inclui testes de memória/persistência da sessão, proteção de origem e Host, parsing multipart fragmentado, cancelamento, rejeição de autorização, encerramento e regras dos gestos. Esses testes usam respostas simuladas e não substituem um teste com imagem real.

O `cookie` transitivo está fixado em 0.7.2 para incluir a correção de validação de cookies. Em 16/10/2026, `npm audit` ainda informa a cadeia transitiva `braces`/`micromatch`/`http-proxy-middleware`/`alexa-cookie2` (GHSA-vfj7-8cjw-p6xm), sem versão corrigida de `braces` no registro consultado. O proxy usa contexto padrão estático, sem padrões glob vindos do usuário, e escuta somente no loopback. A auditoria não está limpa; não exponha as portas 8877/8878 à internet.
