# Casa Universal no ChatGPT

Esta versão acrescenta uma ponte privada no Netlify. O ChatGPT usa OAuth e MCP HTTP em `https://casa-universal.netlify.app/mcp`. O ESP32 faz somente conexões HTTPS de saída: o roteador não precisa abrir portas, e o Mac pode ser desligado depois da configuração. O painel local continua abrindo sem código.

**Estado de implantação:** o código pode estar publicado antes de as variáveis privadas serem importadas. Nesse caso `/mcp` retorna `503 setup_required`. Isso não significa que o ChatGPT já esteja conectado. Veja `/chatgpt` no site para conferir se o serviço foi configurado. A conexão real ainda precisa ser criada e autorizada na conta ChatGPT.

## Ativar uma vez

1. Conecte o ESP32 por USB ao Mac e abra `http://127.0.0.1:8866/` com `python -m casa.esp32_setup` iniciado no ambiente do projeto.
2. Em **Casa Universal no ChatGPT**, selecione **Preparar conexão** e **Baixar configuração privada do Netlify**. O arquivo é gerado localmente, reutilizado nas próximas aberturas e contém credenciais somente desta ponte. Não o publique no GitHub.
3. No projeto `casa-universal` do Netlify, abra **Project configuration → Environment variables → Add a variable → Import from a .env file** e importe esse arquivo. Use **Production** e o escopo **Functions**, ou **All scopes**. Se sua interface não oferecer importação, cadastre individualmente as quatro variáveis do arquivo. Não as coloque no `netlify.toml`.
4. Faça um novo deploy da branch `main`. Abra `https://casa-universal.netlify.app/chatgpt`; ela deve informar **Serviço configurado**.
5. Volte à tela USB e selecione **Ativar no ESP32**. O Mac primeiro verifica a credencial com o Netlify por HTTPS, sem enviar comandos, e só então grava a conexão na placa.
6. No **ChatGPT pelo navegador**, abra **Plugins → + → Adicionar servidor MCP personalizado**. Informe **Casa Universal**, URL `https://casa-universal.netlify.app/mcp` e autenticação **OAuth**. A opção depende das permissões e disponibilidade na sua conta.
7. Crie e instale o plugin. Na autorização da Casa Universal, informe a **chave ChatGPT** da tela USB. Marque **Permitir também enviar os comandos que eu pedir** se quiser controle; sem essa marca, a conexão permite somente consultas. Essa chave é diferente do MCP local e não é a senha do Wi-Fi.
8. Em uma conversa nova, selecione `@Casa Universal` e peça **Liste meus aparelhos, sem acionar nada**. Confira que a ferramenta foi chamada e retornou os aparelhos reais. Depois você pode pedir **A TV está ligada?** ou um comando específico, como **Aumente o volume da TV**.

O procedimento de instalação acima segue a [documentação oficial de conexão MCP no ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server). A documentação confirma o acesso de configuração pelo navegador. Não presumimos disponibilidade do plugin no aplicativo iOS: verifique se ele aparece nessa superfície na sua conta. Enquanto isso, o painel web da casa continua funcionando no Safari.

## O que funciona nesta ponte

Cinco ferramentas: `listar_dispositivos`, `consultar_casa`, `consultar_dispositivo`, `consultar_historico` e `controlar_dispositivo`. Elas usam os mesmos drivers locais da placa. A ponte não cria integrações Tuya, Sonoff ou HAHA que ainda estejam pendentes. Fechaduras não podem ser destrancadas. Comandos IR não medem temperatura nem confirmam se um aparelho está ligado.

A placa consulta o serviço a cada 15 segundos. Um pedido remoto pode levar alguns segundos para chegar. Consultas de estado podem demorar mais quando aparelhos não respondem. O MCP espera até 25 segundos; a fila aceita pedidos por 30 segundos. Pedidos que a placa não recebeu são cancelados. Se a placa recebeu mas não confirmou o resultado, a resposta informa incerteza e o assistente não deve repetir o comando automaticamente.

O ID do último pedido é gravado na NVS **antes** de enviar o comando. Assim, uma queda de energia não repete, por exemplo, um botão de ligar/desligar. A entrega privilegia não repetir comandos: uma falha entre gravar o ID e executar pode deixar o resultado desconhecido. Consulte o histórico ou o aparelho antes de repetir manualmente.

## Dados e acesso

- O Firestore continua sendo a cópia dos controles; suas regras não precisam mudar para esta ponte.
- Netlify Blobs guarda registros OAuth, pedidos e resultados. Os dados enviados são IDs, nomes, cômodos, ações e estados; configurações de rede, chaves dos aparelhos, Wi-Fi e identidade Firebase permanecem no ESP32.
- As quatro variáveis de ambiente são `CASA_PUBLIC_URL`, `CASA_BRIDGE_TOKEN`, `CASA_OAUTH_SECRET` e `CASA_PAIRING_HASH`. Somente o hash da chave de autorização humana vai ao Netlify. As outras duas chaves são independentes e não equivalem à chave MCP local.
- O serviço é limitado a uma casa, a este domínio de produção e a callbacks HTTPS do ChatGPT. OAuth exige PKCE S256 e recurso exato; códigos e refresh tokens são consumidos com escrita condicional. Tokens de acesso duram dez minutos; refresh tokens duram trinta dias e são rotacionados.
- Os registros ficam em um store privado `casa-mcp-v1`, persistente entre deploys. Esta versão não apaga automaticamente o histórico do store; o proprietário pode gerenciá-lo no Netlify. Não publique esse store ou seus downloads.
- **Desativar conexão remota** na tela USB interrompe o acesso aos aparelhos. Para invalidar todos os tokens OAuth, altere `CASA_OAUTH_SECRET` e faça novo deploy. Para substituir a instalação inteira, gere credenciais novas, atualize as variáveis e a placa; não apague o arquivo privado como uma ação rotineira.
- A consulta periódica usa Functions e Blobs. Em operação contínua, há aproximadamente 172.800 consultas da placa por trinta dias, além das chamadas do ChatGPT. Confira os limites e consumo do seu plano Netlify; não é uma garantia de operação gratuita.

## Verificar e desenvolver

`npm ci` instala a dependência Netlify Blobs; `npm test` verifica autenticação, consentimento, expiração, refresh, indisponibilidade e a entrega única da fila. `python3 scripts/build_site.py` continua copiando somente os arquivos públicos. A função fica em `netlify/functions/casa.mjs` e o núcleo em `netlify/lib/bridge.mjs`.

O firmware usa validação TLS com a raiz DigiCert Global Root G2 verificada contra o emissor do certificado atual do Netlify. Uma mudança de autoridade certificadora exige atualizar a raiz; nunca usar `setInsecure()` como solução. Compilar e gravar somente o firmware preserva LittleFS/NVS e os controles cadastrados.
