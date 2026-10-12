# Central Casa Universal · ESP32-S3 N16R8

Firmware Arduino/PlatformIO para ESP32-S3 com **16 MB de flash e 8 MB de PSRAM OPI**. A placa serve o painel visual, recebe chamadas MCP pela rede local e salva configurações em LittleFS. Não depende do Mac depois de conectada ao Wi-Fi e alimentada por USB.

## Suporte desta versão

| Função | Implementação |
| --- | --- |
| Samsung | Descoberta SSDP/API local, leitura de `PowerState`, controle WebSocket TLS com identidade do certificado importada e token persistente. Wake-on-LAN não confirma que ligou. |
| BroadLink RM pro+ | Descoberta UDP, autenticação, envio e aprendizado IR; catálogo público de 387 perfis; controles genéricos por botão. Não aprende RF. |
| Bluetooth | Busca anúncios, nomes, intensidade do sinal e serviços. Não faz pareamento nem abre a fechadura HAHA. |
| Sonoff | Busca anúncios eWeLink por mDNS. O driver de controle não foi portado. |
| Tuya | Cadastros preservados. Busca e controle ainda não foram portados. |
| Firestore | Sincronização das configurações pela identidade existente da central; TLS com raízes Google, validação de regras privadas e exclusão de credenciais. |
| MCP | 11 ferramentas por HTTP Streamable, endpoint `/mcp`, protegido pela chave da central. |

Cadastros preservados não significam que todos os aparelhos são controláveis. Dispositivos pendentes não enviam comandos. IR não fornece temperatura real, energia, trancamento ou posição. Nenhum comando físico é reenviado automaticamente.

## Preparar e gravar

No diretório principal do projeto:

```sh
.venv/bin/python -m pip install -r requirements-esp32.txt
export PLATFORMIO_CORE_DIR="$PWD/.tools/platformio"
.venv/bin/pio run -d firmware/esp32
```

A compilação usa Arduino ESP32 2.0.17, PSRAM `qio_opi` e as partições deste diretório. Não use esta imagem em uma placa com menos memória.

Para a **primeira instalação**, preserve a flash atual antes de gravar. Ajuste o USB para sua placa:

```sh
mkdir -p data/esp32
.venv/bin/esptool --chip esp32s3 --port /dev/cu.usbmodem101 read-flash 0 ALL data/esp32/backup-original.bin
chmod 600 data/esp32/backup-original.bin
.venv/bin/python scripts/build_esp32_data.py
.venv/bin/pio run -d firmware/esp32 -t buildfs
.venv/bin/pio run -d firmware/esp32 -t upload --upload-port /dev/cu.usbmodem101
.venv/bin/pio run -d firmware/esp32 -t uploadfs --upload-port /dev/cu.usbmodem101
```

`build_esp32_data.py` importa os cadastros e a identidade Firebase do SQLite local. Para Samsung, importe previamente o certificado PEM da sua própria TV para `data/esp32/tv-cert.pem`; o script grava seu SHA-256 na configuração privada. O firmware confere essa identidade antes de enviar o token à TV. Uma TV nova exige essa importação; selecionar outro IP não autoriza outro certificado.

**Atualizações posteriores:** use somente `pio run ... -t upload`. `uploadfs` substitui os arquivos da central, incluindo seus controles. Não execute outra gravação do filesystem sobre controles novos sem copiá-los antes. A cópia Firebase desta versão não restaura automaticamente uma placa apagada.

Em Mac Apple Silicon, se o `mklittlefs` fornecido pelo PlatformIO não executar, compile a ferramenta oficial com o compilador nativo:

```sh
git clone --recurse-submodules https://github.com/earlephilhower/mklittlefs .tools/mklittlefs-src
git -C .tools/mklittlefs-src checkout 340d6a390eac915892f6a385995c614b705a4472
git -C .tools/mklittlefs-src submodule update --init
make -C .tools/mklittlefs-src
cp .tools/mklittlefs-src/mklittlefs .tools/platformio/packages/tool-mklittlefs/mklittlefs
```

## Conectar ao Wi-Fi

```sh
.venv/bin/python -m casa.esp32_setup
```

Abra `http://127.0.0.1:8866/` neste Mac. Preencha o Wi-Fi de **2,4 GHz** e sua senha. O formulário envia os dados pelo USB e mostra o IP recebido do roteador. O nome e a senha ficam na NVS da placa; não são registrados em logs nem enviados ao Firebase.

No Safari do iPhone, na mesma rede, abra `http://IP_DA_PLACA/`. O painel abre diretamente, sem código de acesso. A chave de autenticação do MCP permanece privada e fica na seção recolhida **Mostrar chave de conexão MCP** da tela USB. O endereço `http://casa-universal.local/` também é anunciado por mDNS quando a rede permite. Reserve o IP da placa no roteador para evitar mudanças de endereço.

Depois, alimente a placa com um carregador USB. O Mac e o servidor de configuração podem ser desligados. A placa não fornece energia ao BroadLink: ele continua conectado normalmente.

O painel local usa HTTP e não tem cache offline de PWA. Ao abrir o site Netlify, ele segue automaticamente para `http://casa-universal.local/`, ou para outro endereço escolhido em `/?configurar=1`. O Netlify não acessa a rede de casa nem o Bluetooth da placa.

## MCP no cliente local

Use o exemplo [docs/mcp-esp32.example.toml](../../docs/mcp-esp32.example.toml) com o IP e a chave privada do MCP. O endpoint é `http://IP_DA_PLACA/mcp`; o cabeçalho é `Authorization: Bearer CHAVE`. O cliente MCP precisa estar na rede de casa, mesmo que o painel de entrada esteja hospedado no Netlify. A placa mantém painel e MCP ligados sem Mac; o assistente precisa de um cliente capaz de alcançar esse endereço.

As ferramentas de consulta distinguem **estado desconhecido** de desligado. Abertura de fechadura não está disponível. Testes IR enviam sinais reais e a associação de botões exige a confirmação do resultado observado no aparelho.

## Dados e verificação

`firmware/esp32/data/`, `.pio/`, `.tools/` e `data/` são privados e ignorados pelo Git. A imagem do filesystem contém credenciais da instalação: não publique binários gerados dela. O código-fonte não contém senhas da casa.

Os controles permanecem em `/state.json`, com arquivo anterior para recuperação de gravação. Firestore guarda somente campos portáteis; chaves Wi-Fi, Samsung, Tuya, Sonoff e Firebase permanecem locais. Histórico e sessões ficam na RAM e reiniciam junto com a placa.

Validações feitas nesta instalação: identificação de flash/PSRAM; backup integral; compilação e gravação com hash verificado; boot real com nove cadastros; descompactação dos 387 perfis pelo mesmo miniz do firmware. Também foram verificados o painel visual pela rede, leitura real de standby da Samsung, autenticação do BroadLink, sincronização dos nove documentos no Firestore sem credenciais e inicialização/consulta das 11 ferramentas por cliente MCP HTTP real. Não foram enviados botões físicos durante essa validação.

O catálogo SmartIR conserva sua licença em `catalog-LICENSE-SmartIR.txt` na imagem e no diretório `catalog/` do projeto. miniz 3.0.2 mantém as notificações MIT nos arquivos de origem. Bibliotecas de rede e Bluetooth seguem suas próprias licenças.

Configuração do cliente local conforme a [documentação oficial de MCP do Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Recarregue o cliente para carregar o novo transporte; alterar o arquivo não acrescenta ferramentas à conversa já aberta.
