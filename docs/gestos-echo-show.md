# Gestos com a câmera da Echo Show

## Situação em 16/10/2026

O acesso à câmera da Echo Show foi confirmado pela [ponte local Alexa](ponte-alexa.md): vídeo WebRTC real até 1280 × 720, sem alterar o sistema da Echo. A prévia local reconhece mãos e desenha os 21 pontos sobre o vídeo. O usuário confirmou os pontos na imagem real da Echo após o ajuste do reconhecimento. A calibração de alvos e as intenções de gestos estão implementadas para teste; nenhum comando de gesto foi enviado aos aparelhos.

**Atualização:** o usuário forneceu o XAPK Alexa 2.2.720364.0 e confirmou que vê a câmera no app. A [análise do aplicativo fornecido](alexa-oficial.md) rastreou LiveView/RTCSC e identificou implementação WebRTC. Isso amplia o estudo inicial do cliente de terceiros descrito abaixo, e a investigação posterior demonstrou uma sessão independente com imagem real no navegador.

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

## Usar a prévia de mãos e gestos

1. No Mac, execute `npm ci` e `npm run alexa`. A preparação baixa o modelo oficial de mãos se necessário, verifica seu SHA-256 e prepara o pacote local. Abra **http://127.0.0.1:8877/**.
2. Faça login manualmente se a sessão não estiver disponível. Clique em **Abrir câmera da Echo** e aguarde a mensagem de imagem recebida.
3. Clique em **Iniciar teste de gestos**. Mostre uma mão inteira, iluminada, perto da câmera no primeiro teste. Os pontos acompanham a mão. Pontos âmbar indicam detecção que ainda não permite selecionar um alvo, por exemplo, mão pequena ou parcialmente fora da imagem. O diagnóstico mostra quantidade de mãos e tempo de processamento.
4. Adicione um aparelho e use **1. Marcar na imagem** para clicar na localização dele no vídeo. Depois clique em **2. Aprender direção**: são 3 segundos para se posicionar e 2 segundos para apontar, mantendo a mão inteira visível. A direção só é aceita com amostras suficientes e estáveis.
5. Clique em **Salvar calibração**. A configuração fica em `data/gestures/calibration.json`, com acesso somente pelo usuário do Mac. Ela é vinculada à câmera e carregada nas próximas aberturas. Esta calibração ainda não é sincronizada com o Firestore.
6. Aponte para selecionar e espere o nome aparecer em **Alvo selecionado**. Faça uma pinça para confirmar. Na cortina, informe a abertura inicial, segure a pinça e suba/desça a mão; no projetor, deslize em quatro direções ou faça a pinça para OK. As intenções aparecem no painel, sem acionar os aparelhos. **Rearmar seleção** permite repetir o teste de energia.

Mantenha a câmera fixa e use a mesma posição na sala durante a calibração e o teste. Esta versão compara a direção estimada do dedo com as direções aprendidas; ela não reconhece objetos nem calcula a posição absoluta da pessoa na sala. Alvos com direções muito próximas são recusados como ambíguos. A calibração com a mão perto da câmera não substitui calibrar a posição de uso pretendida.

O reconhecimento usa [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js), pacote `@mediapipe/tasks-vision` fixado em `0.10.32`, em um Worker com CPU. Os scripts, WASM e modelo são servidos pela ponte local. Os frames são analisados neste navegador; não são gravados nem enviados ao Firestore ou a um serviço de IA. O vídeo continua usando a conexão Amazon autorizada.

Modelo: [hand_landmarker.task, float16/1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task), SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`. Pacote e modelo conservam suas licenças de origem; não são artefatos obtidos do APK Alexa.

A análise usa a resolução recebida, até 1280 px de largura, com no máximo um frame em processamento e captura até 10 vezes por segundo. Não há solicitação da câmera ou do microfone do Mac. Mãos incompletas, múltiplas mãos, perda de imagem e resultados atrasados impedem a seleção. Ocultar/sair da aba, parar o teste ou encerrar o vídeo termina o reconhecimento e limpa as marcações.

`GET /api/gestures/status` e a seção `gestures` de `/api/status` mostram apenas estado recente da prévia, quantidade de mãos, motivo padronizado, alvo selecionado e tempo de inferência. O estado expira em 2 segundos; não contém imagem nem coordenadas da mão. `commandsEnabled` é sempre `false`. Ainda não há ferramenta MCP de gestos publicada.

## Integração com os aparelhos: pendente

O caminho é **vídeo → reconhecimento local das mãos → seleção de alvo calibrado → comandos existentes da central ESP32**. As três primeiras etapas têm implementação de prévia. A última depende da calibração real e do mapeamento de cada alvo para um controle existente. Não é necessário passar cada frame pelo ChatGPT/MCP.

O processamento desta versão ocorre no navegador do Mac e a ponte Amazon precisa permanecer ligada. O Mac do usuário está disponível apenas durante testes. Ainda não validamos outro processador permanente, processamento na própria Echo ou no ESP32-S3.

| Alvo | Intenção | Condição antes de habilitar |
| --- | --- | --- |
| Cortina | Selecionar e subir/descer a mão para ajustar abertura | Validar DP gravável de posição. O driver atual envia abrir/fechar/parar; leitura percentual não significa ajuste percentual implementado. |
| Ventilador, luminária e luz do quarto | Apontar e confirmar para alternar energia | Calibrar os alvos, mapear aparelhos reais, aplicar permanência, rearme e intervalo entre comandos para evitar alternância a cada frame. |
| Projetor | Selecionar projeção, deslizar nas quatro direções e confirmar OK | Cadastrar/testar os botões IR do projetor e calibrar gesto de confirmação. Um movimento em profundidade é ambíguo numa câmera 2D. |
| Energia do projetor | Ligar/desligar | Verificar códigos e comportamento do modelo, inclusive eventual segunda confirmação para desligar. IR enviado não confirma estado físico. |

Apontar para um objeto exige calibrar a câmera e os alvos na sala; a posição de um dedo na imagem, isoladamente, não identifica o objeto no espaço. O desenho da interação deve mostrar o alvo selecionado antes de executar ações.

O controle de cortina precisará limitar/coalescer comandos e encerrar movimento ao perder a mão. Não enviaremos comandos por frame. O MCP poderá consultar/configurar o módulo por uma integração futura, usando as mesmas ações validadas da central. A prévia local não publica sua configuração nem uma ferramenta de visão no MCP remoto.

## Verificação da página

`node --test tests/camera-probe.test.mjs` cobre início explícito sem áudio, recusa de permissão, autorização tardia depois de cancelar, ausência de frames, chegada de imagem, cancelamento durante espera, contexto sem API/sem HTTPS e encerramento pelo sistema. Esses testes validam o código; não substituem o teste físico na Echo.


`npm test` cobre a extração de características, desenho de mãos pequenas/parciais, rejeição de múltiplas mãos para seleção, direções ambíguas, calibração estável, validação/persistência privada e expiração do estado. Os testes HTTP usam uma ponte simulada e não enviam comandos aos aparelhos. O motor de intenções tem testes de permanência, pinça, navegação, arraste de cortina, perda da mão e frames atrasados. A confirmação dos pontos pelo usuário é a validação física feita nesta etapa; seleção de alvo e execução de gestos ainda precisam de validação na sala.
