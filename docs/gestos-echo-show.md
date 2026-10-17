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

## Apontar para o aparelho e controlar

O modo padrão é **apontar com troca automática**, sem escolher o aparelho no menu durante o uso. A Echo precisa enquadrar o usuário e os aparelhos; uma configuração inicial associa os locais na imagem aos cadastros reais da central.

### Configuração única

1. No Mac, execute `npm ci` e `npm run alexa`. Abra **http://127.0.0.1:8877/**, entre na Amazon se necessário e clique em **Abrir câmera da Echo**.
2. Clique em **Marcar locais dos aparelhos (uma vez)**. O assistente pede Cortina, Ventilador, Luminária e Luz do quarto, conforme os alvos vinculados. Clique na imagem sobre cada aparelho. Os comandos ficam desativados durante a configuração.
3. Se um aparelho não aparecer na câmera, use **Este aparelho não aparece na câmera**. Ele ficará sem alvo de apontar até ser marcado, sem inventar uma posição.
4. Os locais são salvos automaticamente neste Mac ao terminar. Não é necessário repetir a configuração ao abrir o painel, desde que a câmera permaneça no mesmo lugar.

Os vínculos com os aparelhos reais ficam em **Configurar aparelhos e direções**, usados somente na configuração. Eles não precisam ser selecionados durante o controle por apontar.

### Uso normal

1. Clique em **Iniciar reconhecimento** e **Ativar gestos da casa** uma vez por sessão.
2. Aponte o antebraço para o aparelho. Uma linha tracejada mostra a direção estimada, o local é destacado e o nome aparece em **Aparelho apontado**.
3. Mantenha a direção confortável por **0,6 segundo** para confirmar. Não há exigência de pinça, mão aberta ou indicador estendido.
4. **Luz e ventilador:** uma confirmação alterna a energia uma vez. Aponte para outro aparelho para controlá-lo. Para repetir no mesmo, aponte para fora dos locais marcados por aproximadamente 0,7 s e volte a apontar. Estado desconhecido bloqueia a alternância desse aparelho.
5. **Cortina:** depois do destaque, suba/desça o punho para abrir/fechar em pulsos curtos, sempre seguidos de uma tentativa de Parar. Aponte para outro aparelho para trocar automaticamente. O percentual mostrado vem do motor, quando disponível; um pulso não representa uma posição percentual exata.
6. **Projetor:** depois de confirmar, mova nos quatro sentidos para navegar e mantenha parado para OK. É necessário aprender os códigos IR/RF reais e marcar a projeção. O envio IR/RF não confirma a reação física.
7. **Parar comandos / cortina**, encerrar a câmera ou sair/ocultar a aba desativa o controle. Se uma parada não for confirmada, a tela informa a falha e o controle físico deve ser usado.

### Como o alvo é escolhido

O seletor projeta na imagem uma linha do cotovelo até o punho, estendida para a frente, e compara essa linha com os locais marcados. No modo palma/indicador, usa os pontos correspondentes da mão. A geometria leva em conta a proporção da imagem e rejeita pontos atrás do braço, linhas muito curtas e locais fora do corredor de apontar.

Esta é uma aproximação pela imagem da câmera, não reconhecimento de objetos nem medição da posição 3D da sala. Alvos alinhados na mesma direção são considerados ambíguos e não acionam aparelhos. Ajustar o braço ou a posição da câmera pode separá-los. Aparelhos fora da imagem não podem ser marcados por este método. A confirmação física de cada alvo continua necessária.

Não é mais necessário aprender e repetir uma direção pessoal por aparelho no modo padrão. **Direções aprendidas** e **Escolher na tela** continuam disponíveis como alternativas dentro dos ajustes avançados.

### Ajustes e persistência

Em **Do seu jeito**, escolha o lado mais confortável e ajuste o tempo de confirmação (0,4 a 6 segundos), a tolerância e a amplitude dos movimentos. No modo de apontar com o punho, cotovelo e punho precisam estar visíveis. Uma perda breve suspende comandos e preserva o alvo; o reencontro redefine a referência sem gerar um salto de movimento.

A central é localizada pelo endereço salvo da configuração USB ou por `casa-universal.local`; pode-se informar outro IPv4 privado. Os vínculos e locais ficam em `data/gestures/calibration.json`, acessível somente pelo usuário do Mac, sem frames. A configuração não é sincronizada com o Firestore. Comandos reais nunca são reativados pelo arquivo salvo.

### Processamento e limites

O reconhecimento usa [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) e [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), do pacote `@mediapipe/tasks-vision` fixado em `0.10.32`, em um Worker com CPU. No modo punho, usa-se Pose Full; no modo palma/indicador, Hand. O modelo depende de visibilidade e iluminação e ainda pode perder o acompanhamento. Não é um modelo treinado com exemplos pessoais do usuário.

Scripts, WASM e modelos são servidos localmente. Frames e coordenadas não são gravados nem enviados ao Firestore ou a serviços de IA. O vídeo continua usando a conexão Amazon autorizada. Não há acesso ao microfone ou à câmera do Mac.

| Modelo oficial | Versão | SHA-256 |
| --- | --- | --- |
| [Hand Landmarker](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) | float16/1 | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
| [Pose Landmarker Full](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task) | float16/1 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |

A análise recebe até 1280 px de largura, um frame por vez, até 10 capturas/s. Frames atrasados e perda de acompanhamento suspendem a geração de comandos. O modelo principal acompanha uma pessoa para habilitar a suavização temporal nativa do MediaPipe; não identifica quem é essa pessoa. Um alvo confirmado tolera até 900 ms de perda breve; ao reencontrar o punho, o ponto de referência é atualizado sem transformar o salto em movimento. O acompanhamento do punho não exige detectar os dedos. No modo de apontar, perder o cotovelo não descarta o punho: a cortina já confirmada pode continuar seguindo os movimentos observados. A seleção de outro aparelho exige reencontrar o antebraço. Falta de direção ou perda de detecção não rearma uma luz no modo automático: é preciso apontar para fora dos locais com o braço visível, ou trocar de aparelho. Uma confirmação parcial tolera até 450 ms de perda, descontando esse intervalo do tempo de permanência; não se geram comandos a partir de posições extrapoladas. Frames atrasados pausam o controle sem apagar a trava que impede alternâncias repetidas.

O processamento e a ponte Amazon dependem do Mac ligado. O ESP32 executa os comandos dos aparelhos; ele não processa o vídeo. Ainda não há processamento permanente validado na Echo ou no ESP32.

### API e comandos

- `GET /api/gestures/status`: reconhecimento recente, alvo, resultado do último comando e `commandsEnabled`. Não retorna imagens, coordenadas ou ID da sessão de controle.
- `POST /api/gestures/config`: valida e salva ajustes/vínculos; desativa os comandos.
- `POST /api/gestures/central`: encontra a central e lista aparelhos sem credenciais.
- `POST /api/gestures/arm`: ativação explícita; no modo de apontar, habilita os alvos vinculados com local marcado; no modo manual alternativo, limita a um único alvo escolhido.
- `POST /api/gestures/report`: telemetria limitada e renovação da sessão ativa. Expiração após 5 segundos sem renovação.
- `POST /api/gestures/execute`: comando com sessão válida, sequência crescente, observação recente, alvo salvo e ação permitida. Não há fila de comandos atrasados nem repetição automática após falha.
- `POST /api/gestures/stop`: cancela a sessão e tenta parar a cortina em movimento.

As rotas aceitam mudanças somente pela origem local da ponte. Repetições, resultados atrasados, alvo diferente da sessão manual, comandos não cadastrados e destrancamento são recusados. A confirmação de um interruptor exige uma leitura posterior com o estado esperado, além da confirmação do envio.

O MCP existente continua controlando os aparelhos por suas ferramentas. Esta tela de gestos usa as mesmas ações da central; ainda não publica ferramentas de configuração/visão no MCP remoto nem transmite frames ao ChatGPT.

## Validação

`npm test` inclui testes de permanência sem pinça, movimentos pequenos, rearme após ausência, navegação e pulsos de cortina; reconhecimento sem dedos estendidos; seleção manual sem direção fictícia; calibração tolerante; expiração de sessão; comandos repetidos/atrasados; cancelamento; parada mesmo após falha de envio; e distinção entre envio e estado físico. Esses testes usam dispositivos simulados. O usuário confirmou a melhora do acompanhamento real do punho na Echo. A cortina foi validada fisicamente pelo usuário tanto pelo botão de abertura curta quanto pelo gesto de subir o punho no modo manual anterior. A nova seleção automática por linha do antebraço tem testes de geometria, troca de alvo e rejeição de ambiguidades; seus locais na sala devem ser marcados e validados na imagem real. Ventilador, luminária e luz do quarto foram vinculados aos respectivos cadastros; seus testes físicos de gesto ainda não foram executados. A execução de outros vínculos deve ser verificada no painel, sem tratar um teste unitário como confirmação do aparelho.


### Continuidade do punho e comunicação local

A versão de rastreio de outubro de 2026 usa Pose Full e [jsfeat 0.0.8](https://github.com/inspirit/jsfeat) (MIT) no mesmo Worker. Quando a postura é detectada, pequenos detalhes de imagem ao redor do punho são registrados apenas em memória. Em uma falha breve, Lucas–Kanade piramidal mede o deslocamento desses detalhes, valida o percurso de ida/volta, o erro de imagem e o consenso de pelo menos cinco pontos. Essa continuidade dura no máximo 1,8 segundo sem uma nova detecção de postura; não extrapola a posição nem cria uma direção para selecionar outro aparelho. Imagem plana, mudança de cena, intervalo maior que 350 ms ou uma observação explicitamente ambígua interrompem esse recurso. Os quadros não são gravados nem enviados para outro serviço de reconhecimento.

O nome `casa-universal.local` é resolvido uma vez ao conectar; os comandos seguintes usam o IP privado encontrado, evitando repetir a resolução mDNS antes de cada envio e da parada da cortina. A conexão também busca anúncios Sonoff e atualiza IP/porta apenas quando o ID coincide com um aparelho já cadastrado, preservando a chave existente. Isso cobre mudanças de endereço por DHCP sem pedir novos cadastros ao usuário.

Ao confirmar a cortina, a seleção fica retida enquanto o punho sobe/desce, mesmo quando o raio passa por uma luminária. Para sair, abaixe o punho abaixo do cotovelo por 350 ms, ou retire-o do enquadramento. Durante uma requisição à central, novas imagens continuam atualizando o acompanhamento, com a emissão de ações suspensa: a espera de rede não se transforma em perda do punho nem cria uma fila de comandos.

A seleção usa uma área adaptada ao espaço entre os locais marcados, até 18% da altura da imagem, e uma direção suavizada separadamente da posição do punho. Pequenos desvios por até 450 ms pausam a confirmação; direções ambíguas continuam sem acionar aparelhos.


### Seleção nos três eixos

“Ensinar direções em 3D” conduz uma configuração única dos aparelhos vinculados. Para cada nome, o assistente dá três segundos de preparo e reúne 16 vetores válidos do antebraço, sem exigir dedos esticados. A direção é a diferença entre punho e cotovelo em `poseWorldLandmarks`, normalizada nos eixos X, Y e Z. Uma calibração robusta descarta amostras isoladas e rejeita direções muito semelhantes. O painel mostra o vetor 3D estimado e uma bússola com os três eixos; a seleção compara ângulos em 3D, inclusive diferenças de Z que não aparecem nas coordenadas da imagem.

São estimativas monoculares do Pose Landmarker, não medições de um sensor de profundidade nem coordenadas absolutas da casa. O modelo precisa enxergar o antebraço; continuidade óptica do punho, sozinha, não fornece uma nova direção 3D. Quando essa direção falta, a seleção pausa e o painel indica leitura incerta. O controle de uma cortina já confirmada ainda pode acompanhar o movimento visível do punho. As direções aprendidas ficam no arquivo privado de calibração do Mac; nenhum vídeo é salvo. Não é necessário clicar nos aparelhos durante o uso normal depois de ensinar as direções.


O rastreio principal usa `numPoses: 1`: o [grafo oficial do MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/pose_landmarker/pose_landmarker_graph.cc) só ativa a suavização temporal de landmarks para uma pose. Pedir duas poses quando há apenas uma pessoa também força novas detecções do corpo. A margem para desempatar alvos 3D se ajusta à separação entre suas direções aprendidas (1,5° a 4°); o ponto médio entre direções continua sem acionar aparelhos.
