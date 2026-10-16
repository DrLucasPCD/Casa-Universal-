# Gestos com a câmera da Echo Show

## Situação em 16/10/2026

O acesso à câmera da Echo Show foi confirmado pela [ponte local Alexa](ponte-alexa.md): vídeo WebRTC real até 1280 × 720, sem alterar o sistema da Echo. A prévia local reconhece mãos e desenha os 21 pontos sobre o vídeo. O usuário confirmou os pontos na imagem real da Echo após o ajuste do reconhecimento. O reconhecimento do punho e antebraço também foi confirmado pelo usuário como mais confortável. A ponte implementa confirmação por permanência e envio de comandos reais à central ESP32, com ativação explícita na tela. A configuração inicial permanece em prévia.

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

## Usar gestos acessíveis e comandos reais

1. No Mac, execute `npm ci` e `npm run alexa`. A preparação baixa e verifica os dois modelos oficiais. Abra **http://127.0.0.1:8877/** e clique em **Abrir câmera da Echo**.
2. Em **Do seu jeito**, escolha **Punho e antebraço** e o lado direito/esquerdo mais confortável. Esse modo acompanha cotovelo e punho, sem exigir dedos estendidos, mão aberta ou pinça. Há também acompanhamento da palma e o modo anterior pelo indicador.
3. Clique em **Iniciar reconhecimento**. O círculo acompanha o punho; a linha representa o antebraço. Ajuste a sensibilidade, a tolerância a pequenos movimentos e a amplitude da navegação conforme seu conforto. O tempo padrão é **0,6 segundo**; existem opções de 0,4 a 6 segundos.
4. Use **Escolher na tela** para selecionar o alvo sem calibrar uma direção. Vincule **Aparelho real deste alvo** a um aparelho da central. Para interruptores com vários canais, selecione o canal. Para um controle IR/RF, associe os botões disponíveis aos comandos do gesto. Clique em **Salvar calibração**.
5. Teste primeiro a prévia. O círculo preenche enquanto você mantém o punho confortável e parado. Para enviar comandos, clique em **Ativar comandos reais**. O nome do alvo fica visível antes do envio.
6. **Energia:** confirme por permanência para alternar uma vez. O app consulta o estado real antes de escolher ligar/desligar. Retire o punho por 1,2 s ou clique em **Rearmar seleção** antes de repetir. Se o estado for desconhecido, a alternância fica bloqueada.
7. **Cortina:** confirme o alvo e suba/desça o punho para enviar abrir/fechar por um intervalo curto; a ponte sempre tenta enviar Parar após o envio, inclusive se a resposta do movimento falhar. Cada pulso aguarda o comando anterior. O percentual exibido vem do motor, quando disponível; o movimento não representa um ajuste percentual exato.
8. **Projetor:** depois de confirmar, mova nos quatro sentidos para navegar; mantenha parado para OK. É necessário cadastrar/aprender os códigos IR/RF reais primeiro. O envio de IR/RF não confirma a reação física.
9. **Parar comandos / cortina** cancela a sessão e solicita a parada de um movimento em curso. Encerrar a câmera ou ocultar/sair da aba também desativa os comandos. Uma falha de comunicação durante a parada é mostrada na tela; use o controle físico se não houver confirmação.

A central é localizada pelo endereço salvo da configuração USB ou por `casa-universal.local`; pode-se informar outro IPv4 privado no painel. A ponte só encaminha operações predefinidas, sem seguir redirecionamentos ou encaminhar credenciais Amazon. Os dispositivos são listados sem as chaves locais.

A configuração fica em `data/gestures/calibration.json`, com acesso somente pelo usuário do Mac. Ela contém câmera, alvos, ajustes e vínculos, sem frames. Os comandos reais nunca são reativados pelo arquivo salvo. Esta configuração ainda não é sincronizada com o Firestore.

### Apontar na sala (opcional)

No modo **Apontar na sala**, marque cada aparelho na imagem e use **Aprender direção**. Após 3 segundos de preparação, a captura acumula até 16 amostras ao longo de até 12 segundos, com progresso visível. O ajuste descarta amostras isoladas e aceita uma variação limitada, sem exigir esticar os dedos. A direção deve ser reaprendida ao trocar modo de rastreamento ou lado do corpo.

Mantenha a câmera e a posição de uso constantes. Esta versão compara direções aprendidas; não reconhece objetos nem calcula a posição absoluta da pessoa na sala. Alvos de direção ambígua são recusados. A seleção na tela dispensa essa calibração e mantém o controle no aparelho escolhido.

### Processamento e limites

O reconhecimento usa [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) e [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), do pacote `@mediapipe/tasks-vision` fixado em `0.10.32`, em um Worker com CPU. No modo punho, usa-se Pose; no modo palma/indicador, Hand. O modelo depende de visibilidade e iluminação e ainda pode perder o acompanhamento. Não é um modelo treinado com exemplos pessoais do usuário.

Scripts, WASM e modelos são servidos localmente. Frames e coordenadas não são gravados nem enviados ao Firestore ou a serviços de IA. O vídeo continua usando a conexão Amazon autorizada. Não há acesso ao microfone ou à câmera do Mac.

| Modelo oficial | Versão | SHA-256 |
| --- | --- | --- |
| [Hand Landmarker](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) | float16/1 | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
| [Pose Landmarker Lite](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | float16/1 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |

A análise recebe até 1280 px de largura, um frame por vez, até 10 capturas/s. Frames atrasados, perda de acompanhamento e múltiplas pessoas no modo punho suspendem a seleção. O acompanhamento do punho não exige detectar os dedos.

O processamento e a ponte Amazon dependem do Mac ligado. O ESP32 executa os comandos dos aparelhos; ele não processa o vídeo. Ainda não há processamento permanente validado na Echo ou no ESP32.

### API e comandos

- `GET /api/gestures/status`: reconhecimento recente, alvo, resultado do último comando e `commandsEnabled`. Não retorna imagens, coordenadas ou ID da sessão de controle.
- `POST /api/gestures/config`: valida e salva ajustes/vínculos; desativa os comandos.
- `POST /api/gestures/central`: encontra a central e lista aparelhos sem credenciais.
- `POST /api/gestures/arm`: ativação explícita; no modo manual, vincula a sessão a um único alvo escolhido.
- `POST /api/gestures/report`: telemetria limitada e renovação da sessão ativa. Expiração após 5 segundos sem renovação.
- `POST /api/gestures/execute`: comando com sessão válida, sequência crescente, observação recente, alvo salvo e ação permitida. Não há fila de comandos atrasados nem repetição automática após falha.
- `POST /api/gestures/stop`: cancela a sessão e tenta parar a cortina em movimento.

As rotas aceitam mudanças somente pela origem local da ponte. Repetições, resultados atrasados, alvo diferente da sessão manual, comandos não cadastrados e destrancamento são recusados. A confirmação de um interruptor exige uma leitura posterior com o estado esperado, além da confirmação do envio.

O MCP existente continua controlando os aparelhos por suas ferramentas. Esta tela de gestos usa as mesmas ações da central; ainda não publica ferramentas de configuração/visão no MCP remoto nem transmite frames ao ChatGPT.

## Validação

`npm test` inclui testes de permanência sem pinça, movimentos pequenos, rearme após ausência, navegação e pulsos de cortina; reconhecimento sem dedos estendidos; seleção manual sem direção fictícia; calibração tolerante; expiração de sessão; comandos repetidos/atrasados; cancelamento; parada mesmo após falha de envio; e distinção entre envio e estado físico. Esses testes usam dispositivos simulados. O usuário confirmou a melhora do acompanhamento real do punho na Echo. A execução física de cada vínculo deve ser verificada no painel, sem tratar um teste unitário como confirmação do motor ou do aparelho.
