# Casa Universal

Painel local para Samsung, BroadLink, Smart Life/Tuya e Sonoff/eWeLink, com descoberta Bluetooth para investigar a fechadura HAHA. Funciona no Mac e no Safari do iPhone. O servidor precisa permanecer ligado durante o uso.

Marca visual: **casa.**. Para publicar a entrada pública e a demonstração no Netlify pelo GitHub, veja [publicação e arquitetura](docs/publicacao.md). O build já está configurado em `netlify.toml`. Os controles reais e o MCP continuam na central da casa; o site publicado abre o painel dessa central pelo endereço informado.

**Central ESP32-S3 N16R8:** há uma versão de firmware para manter painel, Samsung, BroadLink e MCP na placa, sem o Mac ligado. Veja [instalação, suporte e limitações](firmware/esp32/README.md). Tuya, controle Sonoff e driver da fechadura HAHA ainda não foram portados para essa versão; a descoberta Bluetooth está disponível. As instruções abaixo descrevem a central Python no Mac.

## Abrir e usar

1. Dê dois cliques em **Iniciar no Wi-Fi.command**. O painel abre em `http://127.0.0.1:8787`. Para usar apenas no Mac, escolha **Iniciar no Mac.command**.
2. Em **Conexões → Encontrar dispositivos**, toque em **Buscar tudo** ou escolha uma marca. As buscas não desligam, reiniciam nem redefinem aparelhos.
3. Escolha **Usar nesta conexão** no resultado. Isso preenche IP, MAC e/ou ID; as credenciais pessoais continuam sendo necessárias quando o protocolo as exige.
4. Na Samsung, abra **Controles → Parear com a TV** e aceite **Casa Universal** na tela da TV. O pareamento não envia botões. Depois, teste os controles.
5. Consulte os estados quando precisar. **Enviado** significa que o transporte aceitou o envio; infravermelho e Wake-on-LAN não confirmam o estado físico do aparelho.

A instalação inicial usa Python 3.11 ou superior, ambiente `.venv` e as dependências fixadas em `requirements.txt`. Nesta máquina elas já estão instaladas. Encerre com `Ctrl+C` no terminal que executa o servidor. Não execute duas cópias na mesma porta. O Mac entra em repouso e interrompe os testes se não permanecer acordado.

## Controles BroadLink por marca

Em **Controles → Controle BroadLink → Adicionar aparelho por marca** ou **Conexões → Controles prontos por marca**:

1. Escolha o tipo de aparelho, a marca e o modelo/perfil.
2. Selecione um botão e toque em **Testar este botão**. Esse passo envia um sinal real pelo BroadLink.
3. Observe a resposta do aparelho. Teste outros botões; se falharem, escolha outro perfil da marca.
4. Marque **Testei no aparelho e este controle funcionou**, dê um nome e toque em **Funcionou — salvar controle**.

O controle completo fica salvo como um novo aparelho. Ele usa a conexão do BroadLink principal, inclusive quando o IP desse BroadLink for atualizado. Você também pode aprender botões do controle físico. Aprendizado de RF não está implementado.

O catálogo local contém **387 perfis, 160 marcas e 98.852 códigos IR**: 50 perfis de TV/áudio, 323 de ar-condicionado, 11 de ventilador e 3 de iluminação. Os perfis são contribuições públicas e precisam ser testados no seu modelo. A fonte está identificada em cada perfil e em `catalog/index.json`, com licença em `catalog/LICENSE-SmartIR.txt`. Não é a base privada da BroadLink. Foram excluídos outros transportes, códigos RF, sequências e três arquivos com JSON inválido. Códigos sem apoio no catálogo podem ser aprendidos do controle original.

## Controles genéricos: botão por botão

Em **Controles → Criar controle genérico**, escolha TV, ar-condicionado, projetor, ventilador, som/receiver ou outro aparelho. Dê um nome e um cômodo. Os botões começam sem códigos: nenhum botão vazio pode acionar um aparelho.

Toque em um botão para **Aprender do controle físico** ou **Escolher código por marca**. No catálogo, selecione o comando que realmente corresponde à função desejada, teste, observe o aparelho e confirme **Funcionou — salvar neste botão**. A associação altera somente aquele botão e preserva os demais. Você pode misturar perfis, renomear botões, adicionar funções próprias, remover um código e avançar para o próximo botão. O aprendizado guarda o sinal recebido; teste o botão salvo para verificar a reação física.

No ar-condicionado, muitos sinais representam o ajuste inteiro (modo, ventilação e temperatura). Prefira botões específicos, como **Resfriar · 24 °C**, quando precisar de um ajuste previsível. Um botão “Temperatura +” aprendido não faz o aplicativo conhecer ou acompanhar a temperatura real.

## Centro de controle visual e estados

**Minha casa** mostra um resumo de energia, temperatura, fechadura e cortina, além dos controles por aparelho. O painel consulta os dispositivos a cada 15 segundos enquanto está visível, suspendendo a consulta automática enquanto há um diálogo aberto. A hora da última consulta aparece no resumo. Sem resposta da ponte, os dados anteriores não são uma leitura nova.

Os dados exibidos dependem das integrações configuradas:

- A Samsung informa energia quando sua API local fornece `PowerState`; ausência dessa informação ou falha de rede nunca é tratada como desligamento.
- Tuya pode informar ligado/desligado e leituras pelos DPs escolhidos na configuração. Para temperatura, informe o DP, unidade e divisor (1, 10 ou 100); para cortina, informe o DP que reporta posição em porcentagem, se existir.
- Entidades Home Assistant fornecem estado e, quando disponíveis, temperatura ambiente, temperatura ajustada, atividade do ar-condicionado, posição da cortina, bateria e umidade.
- Um controle BroadLink pode ter uma **fonte de estado opcional**: marque **Usar uma integração para consultar o estado real** na sua configuração e informe URL, entidade e token de uma central Home Assistant já funcional, por exemplo `climate.ar_da_sala`. Essa entidade informa o estado; os sinais continuam saindo pelo BroadLink. A fonte é configurada para cada aparelho e não é copiada do BroadLink principal para novos controles.
- Infravermelho sozinho não informa estado, temperatura ambiente nem posição. Nesse caso o painel e o MCP retornam **estado não confirmado/unknown** e **sem leitura**.
- Fechadura **destrancada** não comprova que a porta esteja fisicamente aberta. O driver HAHA continua pendente; nenhum estado de fechadura é fabricado.

Uma central Home Assistant ou um sensor de temperatura não foi instalado automaticamente. O suporte de leitura está preparado, mas só haverá dados reais quando a fonte correspondente estiver conectada.

## Situação dos seus aparelhos

| Aparelho | Integração e o que falta |
| --- | --- |
| Samsung UN50DU8000GXZD | Descoberta e configurada na instalação de testes; precisa da autorização na TV para receber botões. Busca SSDP e verificação na API local. |
| BroadLink RM pro+ | Descoberto na instalação de testes, tipo `0x279d`; autenticação local respondeu. Pode testar perfis do catálogo e aprender IR. |
| Sonoff Basic 2 / TX1C / TX3C | Três anúncios eWeLink encontrados. Escolha qual corresponde a cada aparelho e forneça a `device key`. TX3C admite três canais separados. |
| Tomada e cortina Smart Life | Quatro anúncios Tuya encontrados. Selecione o aparelho correto e forneça `device_id` + `local_key`. O DP e os valores de movimento da cortina dependem do modelo. |
| Fechadura HAHA | Busca Bluetooth funcional. Foi observado `Lck1_773BBA91BBCE`, compatível pelo nome com a família `Lck1` observada no APK. O serviço anunciado `FFF0` difere do `FFE0` usado no caminho analisado: isso precisa ser validado. Não há driver HAHA de abertura pronto. |

Os endereços e cadastros desta casa não são incluídos no GitHub; outra instalação precisa configurar seus próprios aparelhos. As chaves não estão dentro do APK genérico: pertencem ao dispositivo e à sua conta. Preencha-as no painel deste Mac. Elas ficam em SQLite com permissões locais restritas; não são devolvidas às interfaces nem aos tools. O banco não tem criptografia própria. Não envie senhas ou chaves pelo chat.

Para obter as chaves Tuya pela sua própria conta, use o [assistente TinyTuya](https://github.com/jasonacox/tinytuya), ou integre sua conta no [Home Assistant Tuya](https://www.home-assistant.io/integrations/tuya/). SonoffLAN oferece uma alternativa para autenticação e integração pela sua conta [eWeLink](https://github.com/AlexxIT/SonoffLAN). O aplicativo também aceita entidades já funcionais de Home Assistant. Isso não substitui o pareamento da fechadura, nem prova suporte ao seu modelo HAHA.

O IP público informado anteriormente para a cortina não foi consultado. A conexão usa o endereço local descoberto no Wi-Fi. O MAC informado pode ajudar a identificá-la, mas não substitui a chave Tuya.

## No iPhone, sem conta de desenvolvedor

Abra **No iPhone** no painel do Mac: ele mostra o endereço da rede local. No iPhone conectado ao mesmo Wi-Fi, abra esse endereço no Safari e escolha **Compartilhar → Adicionar à Tela de Início**. Essa instalação é uma web app e não exige App Store nem conta de desenvolvedor. [Guia Apple](https://support.apple.com/pt-br/guide/iphone/iphea86e5236/ios)

O Bluetooth é operado pelo Mac; Safari/iOS não disponibiliza Web Bluetooth. No Mac, permita Bluetooth para o aplicativo que está executando o Python/Terminal/Codex quando o sistema solicitar. Acorde a fechadura e aproxime o Mac. Anúncios sem nome também aparecem, e nem todo Bluetooth é uma fechadura.

Como o Mac ficará ligado apenas durante os testes, o painel também funciona apenas nesse período. O uso permanente de todos os protocolos requer uma ponte sempre ligada, com Bluetooth ao alcance da fechadura. Não há central permanente instalada neste projeto. Para acesso fora da rede de casa, será necessária uma conexão privada com essa ponte. Não abra a porta do painel na internet.

O modo Wi-Fi de testes usa HTTP e abre os controles diretamente, sem código de acesso. Para HTTPS, o servidor aceita `--cert certificado.pem --key chave.pem`; use um certificado confiável nos aparelhos. O cache offline exige HTTPS e guarda apenas a interface, nunca comandos pendentes ou respostas de dispositivos. A interface não controla dispositivos com a ponte desligada.

## Controle pelo assistente

O servidor MCP local `casa.mcp_server` oferece **11 ferramentas**: listar dispositivos, consultar um aparelho, consultar a casa inteira, controlar comandos disponíveis, consultar histórico, buscar aparelhos, criar controle genérico, aprender um botão, consultar o catálogo IR, testar um código e associar o código confirmado a um botão. A configuração desta instalação está em `.codex/config.toml` (privado e ignorado pelo Git); para outra máquina, use [o exemplo portátil](docs/mcp-config.example.toml), ajustando os caminhos. A CLI do Codex reconheceu esse servidor como habilitado. Inicialização, descoberta de ferramentas e consulta foram verificadas com um cliente MCP real por stdio. Uma nova sessão/recarregamento do cliente local precisa carregar a configuração antes que as ferramentas apareçam na conversa. A edição do arquivo não as injeta na sessão atual. [Configuração MCP do Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Posso conduzir a configuração botão por botão pelo MCP: preparo o botão, você pressiona o controle físico ou confirma o resultado de um teste, e salvo a associação. A confirmação da reação física não é inferida do envio. Os comandos e estados usam os mesmos cadastros do painel. A abertura de fechadura não é exposta pelo MCP nesta versão; uma entidade `lock` já funcional de Home Assistant pode ser controlada pelo painel com confirmação explícita. Dispositivos pendentes não enviam comandos.

## Verificação e análise dos apps

Execute `.venv/bin/python -m unittest discover -s tests -v`. Os testes de comandos usam equipamentos simulados e banco temporário; não acionam sua casa. Foi feita também descoberta real na rede, autenticação do BroadLink e consulta da API da Samsung. A reação dos aparelhos aos comandos ainda depende dos testes feitos por você no painel.

A análise está em [docs/analise-apps.md](docs/analise-apps.md), com o índice de evidências em `research/analysis-index.json`. O código Android não foi instalado nem executado. O REA foi usado nos cinco pacotes e em trechos selecionados; isso não equivale a reconstruir integralmente todas as funções proprietárias.

O modo `/?demo=1` simula estados apenas no navegador e não envia comandos. Não use os estados da demonstração como evidência de funcionamento físico.

## Visual dos controles

O painel usa cartões escuros, detalhes em areia e desenhos originais dos aparelhos. Toque no desenho de qualquer aparelho para abrir seu painel. Os filtros de cômodo organizam o centro de controle. TV e projetor têm navegação direcional; cortina tem indicador de posição; fechadura mostra o trancamento informado pela integração; interruptores mostram os canais disponíveis. Botões respondem ao toque e ao foco, e movimentos respeitam a preferência de reduzir animações.

O painel de ar-condicionado separa temperatura ambiente, ajuste escolhido e estado reportado. O seletor de modo, ventilação e temperatura só permite enviar uma combinação com um código realmente salvo no perfil ou botão. Arrastar o seletor prepara o ajuste; “Enviar” transmite uma única vez. Funções sem código ficam indisponíveis. A animação do fluxo depende de atividade reportada, exceto na demonstração explícita `/?demo=1`. Desenhos são representações, não fotos ou detecção do modelo físico.

## Firestore: configurações salvas automaticamente

O projeto Firebase `controle-universal-db135` está configurado em `firebase/config.json`. A ponte autentica sua identidade persistente no Firebase Authentication e usa a API REST oficial do Firestore. Cada controle fica em `casas/{uid}/controles/{id}`. A configuração web do Firebase identifica o projeto; não é uma credencial de administrador. O aplicativo não depende de importar o SDK no navegador nem permite acesso público ao banco.

Nomes, cômodos, informações de conexão sem credenciais, perfis, botões personalizados e sinais IR são salvos. O campo `data` contém JSON compactado com zlib e codificado em Base64 para acomodar perfis grandes dentro do limite por documento. `name`, `room`, `kind`, `digest` e `savedAt` identificam o registro. Compactação não é criptografia; as regras privadas controlam o acesso. Tokens de TV/central, `local_key`, `device_key`, identidade/refresh token Firebase, histórico e leituras ao vivo não são enviados.

O SQLite continua sendo a cópia local. A alteração e a fila de envio são gravadas na mesma transação. A ponte verifica a fila a cada cinco segundos; falhas de internet são tentadas novamente após 45 segundos, sem exigir nova configuração. Apenas configurações alteradas são enviadas, não cada consulta de estado. Alterações feitas por MCP usam a mesma fila. A sincronização funciona enquanto a ponte HTTP estiver ligada. Em Conexões, a seção “Seus controles, salvos” mostra pendências e a última sincronização.

A identidade anônima é criada uma vez e mantida no SQLite, não nos cookies do iPhone. Fechar o app, recarregar a página ou reiniciar a ponte mantém os controles e a identidade. Preserve a pasta privada `data/` ao atualizar ou transferir a central: ela também contém as credenciais locais e a identidade necessária para acessar sua cópia no Firestore. Uma instalação com outra identidade não acessa os dados dessa casa. Controles IR ausentes podem ser restaurados da nuvem ao iniciar a ponte; os endereços e credenciais importados não são ativados automaticamente. A restauração usa o BroadLink configurado localmente e preserva controles que já existam no Mac.

No console Firebase, Authentication → Método de login → Anônimo precisa estar ativado. O banco Firestore `(default)` utiliza as regras em `firebase/firestore.rules`, restritas à identidade desta central. Se o projeto tiver outras coleções, preserve suas regras privadas. A ponte verifica que a coleção recusa leitura sem login antes de enviar qualquer cópia.

Validação: 33 testes passaram, incluindo preservação entre reinícios, exclusão de credenciais, bloqueio de envio com regras abertas, falhas e reenvio, alterações concorrentes e restauração de botões sem importar destinos de rede da nuvem.

Referências: [Firestore REST](https://firebase.google.com/docs/firestore/use-rest-api), [Firebase Authentication REST](https://firebase.google.com/docs/reference/rest/auth), [regras de acesso](https://firebase.google.com/docs/firestore/security/rules-conditions).
