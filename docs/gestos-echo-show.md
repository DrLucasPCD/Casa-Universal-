# Gestos com a câmera da Echo Show

## Situação em 15/10/2026

O acesso à câmera da Echo Show original **ainda não foi confirmado**. O fluxo de gestos não está ativo. Nenhum comando real foi enviado nesta investigação.

**Atualização:** o usuário forneceu o XAPK Alexa 2.2.720364.0 e confirmou que vê a câmera no app. A [análise do aplicativo fornecido](alexa-oficial.md) rastreou LiveView/RTCSC e identificou implementação WebRTC. Isso amplia o estudo inicial do cliente de terceiros descrito abaixo, mas ainda não demonstra uma sessão independente no Casa Universal.

O prefixo de hardware informado pelo usuário sugere **Echo Show 8 de 2ª geração, athena, A8H3N2**. Essa identificação é uma inferência baseada na [tabela técnica do projeto connect-the-dots](https://github.com/gilderchuck/connect-the-dots/wiki), que também alerta que os prefixos nem sempre determinam o modelo. Não incluímos número de série nem MAC nos arquivos públicos.

O [Monitoramento residencial da Amazon](https://digprjsurvey.amazon.com/csad/help/node/GQ5DDPCH5JXERYPB) permite ver a câmera pelo app Alexa ou por outra Echo compatível. Isso não demonstra a existência de uma API pública que entregue os frames ao Casa Universal. A [CameraStreamController](https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-camerastreamcontroller.html) trata da outra direção: disponibilizar uma câmera externa para exibição na Alexa.

O projeto [lineageos-echo-show-camera](https://github.com/jxlarrea/lineageos-echo-show-camera) documenta câmera na **Show 8 de 1ª geração, crown**, com LineageOS 18.1 e modificações do sistema. Ele não confirma suporte à Show 8 de 2ª geração com o sistema Amazon original. Não alteramos o sistema da Echo.

## Análise feita com REA

Aplicamos o fluxo do [REA](https://github.com/morluto/rea/tree/main) ao artefato publicado **alexa-remote2 8.1.1**, um cliente de terceiros do [Apollon77](https://github.com/Apollon77/alexa-remote). Não é o APK oficial Alexa nem o firmware da Echo. A análise foi estática; o cliente não foi executado e nenhum login Amazon foi utilizado.

- Ferramenta: `rea-agents@6.4.0`, `analyze-javascript-application`, seguida de `inspect-analysis-view` com projeção `summary`.
- Origem: `https://registry.npmjs.org/alexa-remote2/-/alexa-remote2-8.1.1.tgz`.
- SHA-256 do tarball: `32c366da620128245b4dfc15d15905fec1664d55d62c326fbb26935f81e558a3`.
- SHA-256 do diretório analisado, segundo REA: `0897a545c2bf1adc30e937bca5682deec1f35ba2e7e0f0b567656ebd237fceab`.
- Evidência: `ev_4de1928ce040b0bb6bad91f163c3977d5a4f384c597f4e7d9fa670cfaddce4ba`.
- 8 arquivos relevantes, 5 JavaScript analisados, 40 achados, grafo com 52 nós e 56 relações. Cobertura parcial; falha de parsing em `example/example.js`.

A busca de referências a câmera, WebRTC, live view, Drop In e SIP no JavaScript desse pacote não revelou um caminho para extrair o vídeo da Echo. **A ausência nesse cliente não prova ausência no app oficial ou no firmware.** A análise estática não comprova comportamento em execução. Evidências completas ficam em `research/evidence/rea-echo-alexa.json` e `rea-echo-view.json`, ignoradas pelo Git.

## Teste a executar na própria Echo

1. Na Echo, abra o navegador Silk e acesse **https://casa-universal.netlify.app/camera**.
2. Abra a tampa física da câmera e toque em **Testar câmera**. Se surgir uma solicitação de vídeo, permita.
3. Só considere acesso confirmado se houver imagem e a página mostrar **Câmera com imagem!**.
4. Informe o resultado da página e que o teste ocorreu na Echo. Se houver erro, abra **Resultado técnico** e copie a fase/código. Um teste no Mac ou iPhone verifica apenas a câmera desse outro aparelho.

A página pede somente vídeo (`audio: false`), nunca inicia captura ao abrir, não grava nem transmite frames, não acessa contas Amazon e não aciona dispositivos. O relatório é local e contém apenas fase, código de erro padronizado, dimensões, disponibilidade da API e identificação do navegador. Nenhum ID ou nome de câmera é coletado.

O botão **Parar**, sair da página ou ocultar a aba encerra as trilhas. Uma autorização que chegar depois de cancelar também tem suas trilhas encerradas. Um fluxo sem frames termina após 10 segundos. A solicitação de permissão pode permanecer pendente por decisão do navegador; nesse caso, use Parar.

`NotAllowedError` pode significar recusa de permissão ou restrição do sistema. `NoCameraAPI` significa que o navegador não expõe a API naquele contexto. Nenhum desses resultados deve ser anunciado como prova de que o hardware não tem câmera. Consulte a documentação de [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Integração a construir depois de validar a entrada de vídeo

O caminho proposto é **vídeo → reconhecimento local das mãos → seleção de alvo calibrado → comandos existentes da central ESP32**. Não é necessário passar cada frame pelo ChatGPT/MCP. O processamento no próprio navegador da Echo depende de compatibilidade e desempenho ainda não medidos. Se for necessário outro processador permanente, isso será uma dependência nova: o Mac do usuário está disponível apenas durante testes. Não há implementação de visão para esta tarefa no ESP32-S3.

| Alvo | Intenção | Condição antes de habilitar |
| --- | --- | --- |
| Cortina | Selecionar e subir/descer a mão para ajustar abertura | Validar DP gravável de posição. O driver atual envia abrir/fechar/parar; leitura percentual não significa ajuste percentual implementado. |
| Ventilador, luminária e luz do quarto | Apontar e confirmar para alternar energia | Calibrar os alvos, mapear aparelhos reais, aplicar permanência, rearme e intervalo entre comandos para evitar alternância a cada frame. |
| Projetor | Selecionar projeção, deslizar nas quatro direções e confirmar OK | Cadastrar/testar os botões IR do projetor e calibrar gesto de confirmação. Um movimento em profundidade é ambíguo numa câmera 2D. |
| Energia do projetor | Ligar/desligar | Verificar códigos e comportamento do modelo, inclusive eventual segunda confirmação para desligar. IR enviado não confirma estado físico. |

Apontar para um objeto exige calibrar a câmera e os alvos na sala; a posição de um dedo na imagem, isoladamente, não identifica o objeto no espaço. O desenho da interação deve mostrar o alvo selecionado antes de executar ações.

O controle de cortina precisará limitar/coalescer comandos e encerrar movimento ao perder a mão. Não enviaremos comandos por frame. O MCP poderá consultar/configurar o módulo quando ele existir, usando as mesmas ações validadas da central. Não há ferramenta MCP de visão ou gesto anunciada como funcional nesta etapa.

## Verificação da página

`node --test tests/camera-probe.test.mjs` cobre início explícito sem áudio, recusa de permissão, autorização tardia depois de cancelar, ausência de frames, chegada de imagem, cancelamento durante espera, contexto sem API/sem HTTPS e encerramento pelo sistema. Esses testes validam o código; não substituem o teste físico na Echo.
