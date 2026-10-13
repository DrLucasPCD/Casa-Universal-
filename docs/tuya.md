# Smart Life / Tuya na central ESP32

Tomadas, cortina, fita LED (liga/desliga) e sensor de temperatura/umidade usam o mesmo driver LAN. O sensor oferece apenas consultas, sem comandos de atuação. O ESP32 implementa Tuya **3.3 e 3.4**, descoberta UDP 6666/6667/7000, TCP 6668 e AES-128-ECB. O protocolo 3.4 negocia uma chave por sessão e verifica HMAC-SHA256; anúncios 6699 usam AES-GCM autenticado. Protocolos 3.1/3.5 e subdispositivos de gateway não são suportados nesta versão. A implementação independente segue o protocolo documentado no [TinyTuya 1.20.0](https://github.com/jasonacox/tinytuya/blob/master/PROTOCOL.md), licença MIT; não inclui o código da biblioteca no firmware.

## Importar suas chaves

1. No Mac, com o ESP32 conectado por USB, abra a tela de configuração `http://127.0.0.1:8866/` → **Tuya · conectar Smart Life**. Para iniciar: `.venv/bin/python -m casa.esp32_setup --port /dev/cu.usbmodem1101` (ajuste a porta).
2. Crie sua conta na [plataforma Tuya](https://platform.tuya.com/). A interface atual documentada usa **Cloud → Cloud Project → Project Management → Create Cloud Project**; algumas contas mostram **Cloud → Development**. Escolha desenvolvimento **Smart Home** e o data center que corresponde à sua conta Smart Life.
3. Confira a disponibilidade e a autorização de **IoT Core** e **Smart Home Basic Service** no projeto. Serviços, planos e limites dependem da sua conta. A Casa Universal não assina planos nem aceita contratos por você.
4. No projeto: **Devices → Link App Account → Add App Account → Tuya App Account Authorization** (ou **Link Tuya App Account**). Escaneie o QR pelo Smart Life e confirme o vínculo no telefone.
5. Copie **Access ID / Client ID** e **Access Secret / Client Secret** da seção **Authorization Key / Overview** e um **Device ID** de **All Devices** para o formulário local. Não coloque chaves no chat, GitHub ou variáveis do Netlify.
6. Clique **Importar meus aparelhos**. Escolha o controle correspondente entre **Tomada**, **Cortina**, **Tomada do ventilador**, **Smart Led Strip** e **Sensor de temperatura e umidade**, confira IP local, DP de comando e tipo da cortina, e salve na central. O Mac só é necessário nessa importação.

O importador faz consultas GET por HTTPS nos endpoints oficiais do data center escolhido: token, informações de um aparelho, lista da sua conta e especificações dos DPs. Quando a especificação contém só códigos, consulta o [modelo oficial](https://developer.tuya.com/en/docs/cloud/bd68171262?id=Kcp4utbhzzfgo) para obter os números dos DPs e as escalas das leituras. Usa [assinatura HMAC-SHA256](https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g), timeout, limite de resposta e bloqueio de redirecionamentos. Access Secret e token não são persistidos. Local keys ficam na RAM por 15 minutos até salvar somente os aparelhos selecionados no ESP32. A cópia Firestore não inclui essas chaves.

Instruções oficiais: [criar projeto e obter chaves](https://developer.tuya.com/en/docs/developer/apply-cloud-api-key?id=Kff30z8sv62ah), [vincular Smart Life por QR](https://developer.tuya.com/en/docs/iot/link-devices?id=Ka471nu1sfmkl), [data centers](https://developer.tuya.com/en/docs/iot/api-request?id=Ka4a8uuo1j4t4).

## DPs e estados

DP é o número da função no aparelho. Verifique em **Devices → aparelho → Debug Device** / definições do produto, ou em uma consulta local autenticada. O DP 1 é apenas o valor inicial do formulário; não prova o mapeamento do seu modelo. A tomada aceita on/off booleano no DP configurado. A cortina permite oito conjuntos de valores (os mesmos do TinyTuya CoverDevice):

| Tipo | Abrir | Fechar | Parar |
| --- | --- | --- | --- |
| 1 | open | close | stop |
| 2 | true | false | indisponível |
| 3 | 1 (texto) | 2 (texto) | 0 (texto) |
| 4 | 01 | 02 | 00 |
| 5 | fopen | fclose | indisponível |
| 6 | on | off | stop |
| 7 | up | down | stop |
| 8 | ZZ | FZ | STOP |

Um DP de movimento não confirma posição final. Somente um DP de posição **reportado** em 0–100 permite indicar fechada (0), aberta (100) ou parcial. Confira a polaridade do seu modelo antes de usar essa leitura. DPs de temperatura e umidade e seus divisores são configuráveis e precisam corresponder ao aparelho. Leituras booleanas, valores fora dos limites e dados não finitos são rejeitados. O visual do ventilador representa a energia da tomada; não confirma movimento físico. A fita LED oferece liga/desliga pelo DP escolhido; cor e brilho precisam de mapeamento próprio para controle completo. O sensor apresenta somente leituras e conexão. Nenhum estado é inventado com base no último botão enviado.

Se o app Smart Life mantiver uma sessão LAN exclusiva, feche-o antes de consultar pela central. Reparear um aparelho pode mudar a local key, exigindo nova importação. Sem chave válida, encontrar um anúncio Wi-Fi não permite controlar ou consultar o estado autenticado.

## Verificação

`scripts/test_tuya_esp32.py` valida o driver no ESP32 contra criptografia e pacotes do TinyTuya sem acionar aparelhos reais. Ele recusa substituir controles já configurados e restaura os slots pendentes. `scripts/test_tuya34_esp32.py` valida negociação 3.4, HMAC, chave de sessão e descoberta GCM. Os testes usam slots pendentes e nunca enviam comandos a aparelhos reais.

O sensor sem pilhas pode ser salvo sem IP. Sua chave permanece somente na central; a descoberta em segundo plano tenta identificar IP e protocolo quando ele anunciar no Wi-Fi. Essa descoberta também acompanha mudanças de IP dos outros aparelhos configurados. Sensores que dormem podem não aceitar consulta LAN enquanto estão inativos. Leituras ausentes não são inventadas. O DP `percent_control` de cortinas é um alvo solicitado; só configure `position_dp` se houver confirmação de que o DP representa a posição medida.
