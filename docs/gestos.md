# Controle por gestos

Abra a ponte local com `npm run alexa` e acesse `http://127.0.0.1:8877/`.
Conecte a câmera, inicie o reconhecimento e confira os resultados em prévia.
“Ativar gestos da casa” habilita o envio aos aparelhos vinculados.

## Movimentos

Primeiro aponte para o aparelho e espere o nome destacar. Não é necessário
estender os dedos ou fazer pinça. O modo recomendado acompanha punho e antebraço.

| Aparelho | Depois da seleção |
| --- | --- |
| Cortina | Subir o punho abre um pouco; descer fecha um pouco. O padrão é um segundo de movimento seguido de Parar. |
| Projetor | Mover para cima, baixo, esquerda ou direita navega. Avançar o punho na direção do braço confirma OK. |
| Luz / ventilador | Apontar pelo tempo de confirmação alterna uma vez. Aponte para fora ou para outro aparelho antes de repetir. |

No modo “Um comando por gesto”, volte à posição em que confirmou o aparelho
e faça uma pausa breve antes do próximo movimento. O retorno não envia o comando
contrário. Cortina e projetor permanecem selecionados durante seus movimentos;
abaixe o braço por um instante para trocar de alvo.

Nos ajustes é possível mudar amplitude, tempo de seleção, duração do movimento
da cortina (350–1500 ms) e escolher OK por permanência. O modo anterior de
deslocamento contínuo continua disponível. Trocar esses ajustes não apaga os
locais ou as direções já aprendidos.

O projetor precisa ter seus botões IR/RF aprendidos no controle BroadLink e
vinculados ao alvo Projetor. Reconhecer um gesto não cria códigos infravermelhos.

## Reconhecimento e limitações

Os deslocamentos são medidos em relação ao ombro, com escala baseada na largura
dos ombros e correção da proporção da imagem. A referência neutra é suavizada
durante a seleção. Uma mediana de três observações e confirmação temporal reduzem
oscilações isoladas. Saltos grandes precisam de outra observação consistente.

“Lado do corpo” escolhe qual braço controla. O painel informa “Punho esquerdo”
ou “Punho direito” quando o acompanha. Cada lado guarda suas próprias direções
3D: ao trocar de braço, as direções desse lado são recuperadas sem apagar as do
outro. Um lado ainda não calibrado pode ser acompanhado na prévia, mas precisa
aprender suas direções antes de selecionar aparelhos em 3D. Trocar a câmera
invalida os perfis de ambos os lados.

O rastreio visual compara o movimento medido na imagem com a nova estimativa do
modelo antes de aceitar um salto do punho. Essa continuidade dura no máximo
1,8 segundo e não inventa direção ou profundidade. O OK por avanço usa extensão
3D estimada do braço, exige observações consistentes e fica indisponível sem
ombro/cotovelo/punho suficientes. A câmera RGB não fornece profundidade medida.

Enquanto a central responde, movimentos não ficam na fila. O bloqueio do retorno
continua valendo depois do envio e de perdas breves de rastreio. Uma falha de
Parar permite uma única nova tentativa de **Parar**, sem repetir Abrir/Fechar.
Falhas persistentes desativam a sessão e são mostradas no painel. A confirmação
do envio não comprova a reação física ou a posição final do motor.

## Validação

`npm test` cobre seleção, movimentos, retorno, falhas breves de imagem, profundidade
ausente, saltos de posição, espera pela central, perda da sessão e parada da cortina.

Os sete vídeos de referência foram processados localmente com Pose Landmarker Full
e o mesmo rastreador visual usado no navegador. Em reprodução isolada do movimento,
com um instante neutro anotado **após a preparação e a seleção do aparelho**, cada
exemplo produziu seu comando esperado, sem comando contrário no retorno. Isso é
um teste dos exemplos usados no ajuste, não uma taxa de acerto em vídeos novos nem
uma validação completa da seleção pela Echo. Os vídeos, imagens e trajetórias
permanecem nos diretórios locais ignorados pelo Git.

O pulso de um segundo foi testado fisicamente com confirmação de abertura curta
e parada. O fluxo ao vivo pela Echo — apontar para a cortina, subir o punho e
retornar sem fechar na volta — também foi confirmado no teste de uso.
Mudar a câmera ou a posição de uso pode exigir reaprender direções.
