# SonoffLAN na Casa Universal

Fonte: [AlexxIT/SonoffLAN](https://github.com/AlexxIT/SonoffLAN), snapshot
`73690b7afae758ce2ab131a43f5f87fac103670a`, licença MIT em
`third_party/LICENSE-SonoffLAN.txt`.

Os módulos `core/ewelink/cloud.py`, `base.py` e `local.py` foram incorporados, sem alterações,
em `casa/vendor/sonofflan/`. O cliente cloud autentica a conta e importa os
dispositivos; o cliente local verifica a interoperabilidade dos testes.
A integração Home Assistant inteira não roda no ESP32.
O protocolo LAN de `local.py` foi adaptado em C++: AES-128-CBC, chave derivada por
MD5, IV aleatório, PKCS7, base64, HTTP `/zeroconf/switch` e `/zeroconf/switches`,
descoberta `_ewelink._tcp.local.` e leitura dos anúncios TXT `data1` a `data4`.

## Conectar uma vez pelo Mac

1. Conecte a placa pelo USB e execute `.venv/bin/python -m casa.esp32_setup`.
2. Abra `http://127.0.0.1:8866/`, seção **Sonoff · conectar eWeLink**.
3. Preencha sua conta, senha e código do país (+55 para Brasil). Autorize o login
   no serviço oficial eWeLink e clique **Importar meus Sonoff**.
4. Para cada dispositivo, confirme o IP local e selecione seu controle Basic 2,
   TX1C ou TX3C; clique **Salvar na central**. Nenhum interruptor é acionado ao salvar.
5. No painel da casa, consulte os estados e teste o comando desejado. O TX3C tem
   ligar/desligar separados para cada canal, numerados de 1 a 3.

A senha e o token da conta não são persistidos. O importador usa TLS com validação
de certificado, destinos eWeLink fixos, sem redirecionamentos e sem operações de
acionamento na nuvem. Os dispositivos e suas chaves ficam em memória por até 15
minutos e somente os escolhidos são salvos no ESP32. Reinicie o assistente para
limpar imediatamente esse cache. Depois da configuração, o Mac pode ser desligado.

Alternativas no painel **Conexões → Configurar → SonoffLAN · eWeLink local**:
preencher a device key pessoal ou selecionar o cache JSON privado do SonoffLAN
em `/config/.storage/sonoff/`. O formato Home Assistant `{data: [...]}` e uma lista
de dispositivos são aceitos. O arquivo é lido no navegador; só os campos do
dispositivo escolhido são enviados à central ao clicar Salvar. Diagnósticos que
ocultam as chaves não servem para importar. Não publique esse arquivo no GitHub.

## Estados e limites

O modo LAN precisa estar disponível no firmware original e na mesma rede da
central, com multicast/mDNS permitido. A compatibilidade física dos aparelhos do
usuário depende dessa configuração e ainda requer a conta/chaves e teste real.
O importador não muda o firmware do Sonoff e não força modo DIY.

São suportados interruptores de 1 a 4 canais e DIY explicitamente confirmado.
Uma confirmação HTTP de comando significa que o Sonoff aceitou a solicitação;
o painel só mostra ligado/desligado a partir de estado recebido do aparelho.
Se `getState` não for suportado, os anúncios mDNS podem fornecer o estado.
Observações sem resposta nova expiram após 60 segundos; um envio nunca inventa
um estado. Uma resposta criptografada válida recebida em uma consulta mDNS ativa
renova a observação mesmo quando o conteúdo e o número de sequência não mudam.
Um interruptor que permanece desligado não perde a leitura só por não mudar de estado. Nos aparelhos de vários canais, o estado geral só é calculado quando
todos os canais têm uma leitura confirmada: ligado se algum canal está ligado,
desligado se todos estão desligados. Respostas excessivas, padding inválido, erros e timeouts são rejeitados.
Comandos não são reenviados automaticamente, pois um timeout pode ocorrer depois
do acionamento. A mudança de IP anunciada para um ID configurado é usada em RAM.

As device keys são excluídas das respostas públicas, do MCP remoto e do Firestore.
O controle e os estados Sonoff usam as ferramentas MCP já existentes. A ponte do
ChatGPT só fica disponível após as variáveis privadas, novo deploy, ativação do
ESP32 e autorização OAuth pelo proprietário.

## Atualizar sem substituir cadastros

Compile e envie somente o firmware pelo PlatformIO. Para atualizar a interface:
`.venv/bin/python scripts/update_esp32_assets.py`. Feche o assistente USB antes de
gravar/atualizar e reabra depois. O atualizador escreve apenas os nove arquivos
públicos permitidos, com blocos ordenados e hash SHA-256 verificado. Não use
`uploadfs` para uma atualização: isso substituiria a partição com os cadastros.
