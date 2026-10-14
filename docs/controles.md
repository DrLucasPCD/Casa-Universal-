# Configurar os controles da casa

Abra o painel da central. Selecione um aparelho para ver seu controle visual. Em um controle personalizado, escolha **Configurar botões** para aprender IR/RF, escolher um código de catálogo ou renomear o botão. A configuração de um botão preserva os demais. Crie controles para TV, ar-condicionado, projetor, ventilador, áudio, iluminação, cortina, tomada ou outro aparelho.

## Philco inverter com controle físico

O BroadLink recebe o sinal completo. Muitos controles de ar enviam temperatura, modo, velocidade e oscilação juntos: aprender somente “aumentar temperatura” não produz qualquer temperatura arbitrária.

1. Selecione no display do app a temperatura, o modo, a velocidade e a oscilação desejados.
2. Clique **Configure este ajuste**. O app prepara um botão para essa combinação.
3. Ajuste o controle físico para exatamente os mesmos valores. Escolha **Aprender IR**, aponte-o para o BroadLink e pressione um botão que transmita esse estado completo. O comando do controle físico também pode atingir o ar-condicionado.
4. Depois da captura, o botão fica salvo. **Testar** transmite esse sinal real; confirme a reação no aparelho antes de considerá-lo compatível.
5. Repita para outras temperaturas/velocidades/oscilação e para desligar.

A seleção no display é temperatura alvo, não temperatura ambiente medida. Ajustes sem sinal salvo continuam indisponíveis. O perfil público Philco possui 409 sinais, mas não há compatibilidade garantida com todos os Philco de 12.000 BTU inverter. O aprendizado do controle original evita depender dessa identificação.

## RF

Requer um BroadLink RM pro/pro+ compatível. Escolha **Aprender RF**, mantenha o botão físico pressionado até o app detectar a frequência e, quando solicitado, solte e pressione novamente para capturar o sinal. Códigos variáveis, frequências não suportadas e controles criptografados podem não ser reproduzíveis. Não há suporte universal a toda fechadura RF.

## Fita LED e cortina Tuya

A luz configurada com HSV12 possui seletor de cor e intensidade. Aplicar um ajuste não liga a luz implicitamente. O percentual e a cor exibidos são informados pelos DPs do aparelho.

Na cortina, configure o **DP de posição** medido. Marque **Inverter percentual** se o motor reportar 0 totalmente aberta e 100 fechada. O app apresenta 0% fechada e 100% aberta. O DP de comando ou de destino não deve ser confundido com posição efetiva.

## MCP

O painel e o MCP remoto compartilham os mesmos controles e sinais. É possível criar um controle, preparar um ajuste de clima, iniciar/consultar/cancelar a captura, configurar e renomear botões, consultar leituras e aplicar luz/clima. A captura não emite IR/RF. Consultar a captura pode salvar o sinal recebido, portanto exige autorização de controle. A central não reenvia comandos físicos automaticamente.
