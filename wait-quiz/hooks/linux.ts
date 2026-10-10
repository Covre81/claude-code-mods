import type { Card } from '../types'

/** Own Linux deck, aligned with RoadToBSCoDev stage 01 (terminal, OS, PATH). Edit freely: one [topic, front, back] per card. */
const CARDS: readonly (readonly [topic: string, front: string, back: string])[] = [
  // navegação
  ['navegacao', 'Qual a diferença entre caminho absoluto e relativo?', 'Absoluto começa na raiz `/` (ex.: /home/bruno/dev) e vale de qualquer lugar. Relativo parte do diretório atual (ex.: dev/notas).'],
  ['navegacao', 'O que significam `.`, `..` e `~` num caminho?', '`.` = diretório atual; `..` = diretório pai; `~` = seu diretório home.'],
  ['navegacao', 'Qual comando mostra em que diretório você está?', '`pwd` (print working directory).'],
  ['navegacao', 'O que faz `cd -`?', 'Volta para o diretório anterior (alterna entre os dois últimos).'],
  ['navegacao', 'Por que `ls` não mostra alguns arquivos, e como vê-los?', 'Arquivos que começam com `.` são ocultos. `ls -a` mostra; `ls -la` mostra ocultos com permissões, dono, tamanho e data.'],
  ['navegacao', 'Como criar `a/b/c` de uma vez, mesmo se `a` não existir?', '`mkdir -p a/b/c` — o `-p` cria os diretórios intermediários e não reclama se já existirem.'],
  ['navegacao', 'Qual tecla autocompleta nomes de arquivos e comandos no terminal?', 'Tab. Duas vezes Tab lista as opções quando há mais de uma.'],
  ['navegacao', 'Como buscar um comando que você digitou antes?', 'Ctrl+R faz busca reversa no histórico; `history` lista tudo.'],
  // arquivos
  ['arquivos', 'O `rm` manda o arquivo para a lixeira?', 'Não. `rm` apaga direto, sem lixeira. `rm -r` apaga diretórios recursivamente — confira o caminho antes.'],
  ['arquivos', 'Qual a diferença entre `cp` e `mv`?', '`cp` copia (o original fica); `mv` move ou renomeia (o original some). Para copiar diretório: `cp -r`.'],
  ['arquivos', 'O que faz `touch arquivo.txt`?', 'Cria o arquivo vazio se não existir; se existir, só atualiza a data de modificação.'],
  ['arquivos', 'Como ver as últimas linhas de um log e continuar acompanhando o que chega?', '`tail -f arquivo.log`. Sem `-f`, `tail -n 20` mostra só as últimas 20 linhas.'],
  ['arquivos', 'Por que usar `less` em vez de `cat` para um arquivo grande?', '`cat` despeja tudo na tela; `less` pagina, permite rolar e buscar com `/` e sair com `q`.'],
  ['arquivos', 'O que é um link simbólico e como criar?', 'Um atalho que aponta para outro caminho: `ln -s alvo nome_do_link`. Apagar o link não apaga o alvo.'],
  ['arquivos', 'Como achar todos os `.log` abaixo do diretório atual?', '`find . -name "*.log"` — as aspas impedem o shell de expandir o `*` antes.'],
  ['arquivos', 'Como procurar um texto dentro de arquivos de uma pasta?', '`grep -rn "texto" pasta/` — `-r` recursivo, `-n` mostra o número da linha, `-i` ignora maiúsculas.'],
  // permissões
  ['permissoes', 'Como ler `-rwxr-xr--`?', 'Primeiro caractere = tipo (`-` arquivo, `d` diretório). Depois 3 trios: dono `rwx`, grupo `r-x`, outros `r--`.'],
  ['permissoes', 'Quanto vale r, w e x em octal?', 'r=4, w=2, x=1. Soma por trio: 7=rwx, 6=rw-, 5=r-x, 4=r--.'],
  ['permissoes', 'O que dá `chmod 755` e `chmod 644`?', '755 = rwxr-xr-x (executáveis e diretórios). 644 = rw-r--r-- (arquivos comuns).'],
  ['permissoes', 'Como tornar um script executável só para o dono?', '`chmod u+x script.sh` (u=dono, g=grupo, o=outros, a=todos).'],
  ['permissoes', 'O que a permissão `x` significa num diretório?', 'Poder entrar/atravessar o diretório (`cd` e acessar o que tem dentro). Sem `x`, nem com `r` você abre os arquivos.'],
  ['permissoes', 'Para que servem `sudo` e `chown`?', '`sudo` roda um comando como root. `chown usuario:grupo arquivo` troca o dono do arquivo.'],
  // pipes e redirecionamento
  ['pipes', 'Quais são os três fluxos padrão de um processo e seus números?', 'stdin = 0 (entrada), stdout = 1 (saída), stderr = 2 (erros).'],
  ['pipes', 'O que o `|` (pipe) faz?', 'Liga o stdout do comando da esquerda ao stdin do da direita. Ex.: `ls | wc -l` conta as entradas.'],
  ['pipes', 'Diferença entre `>` e `>>`?', '`>` sobrescreve o arquivo; `>>` anexa no final.'],
  ['pipes', 'Como mandar stdout e stderr para o mesmo arquivo?', '`cmd > saida.txt 2>&1` — a ordem importa: primeiro stdout vai pro arquivo, depois stderr segue o stdout.'],
  ['pipes', 'Para que serve `/dev/null`?', 'Um "buraco negro": o que é escrito nele é descartado. Ex.: `cmd 2>/dev/null` esconde os erros.'],
  ['pipes', 'Diferença entre `&&`, `||` e `;` entre comandos?', '`a && b` roda b só se a deu certo; `a || b` só se a falhou; `a ; b` roda b sempre.'],
  ['pipes', 'O que é o exit code e como vê-lo?', 'Número que o processo devolve ao terminar: 0 = sucesso, outro = erro. `echo $?` mostra o do último comando.'],
  // processos
  ['processos', 'Diferença entre processo e thread?', 'Processo tem espaço de memória próprio e isolado. Threads vivem dentro de um processo e compartilham a memória dele.'],
  ['processos', 'Como listar os processos em execução?', '`ps aux` tira uma foto; `top` ou `htop` mostram ao vivo, com CPU e memória.'],
  ['processos', 'O que `kill PID` faz por padrão?', 'Envia SIGTERM (15): pede para o processo terminar, e ele pode se limpar antes de sair.'],
  ['processos', 'Quando usar `kill -9` e por que é o último recurso?', 'Envia SIGKILL: o kernel mata na hora e o processo não consegue capturar nem limpar nada (arquivos temporários, conexões).'],
  ['processos', 'O que Ctrl+C e Ctrl+Z fazem com o processo em primeiro plano?', 'Ctrl+C envia SIGINT (interrompe). Ctrl+Z suspende (SIGTSTP); depois `bg` continua em segundo plano e `fg` traz de volta.'],
  ['processos', 'Como rodar um comando em segundo plano?', 'Coloque `&` no final: `comando &`. `jobs` lista os que estão rodando nesse terminal.'],
  ['processos', 'Qual é o PID 1 num Linux moderno?', 'O init — na maioria das distros, o systemd. É o ancestral de todos os outros processos.'],
  ['processos', 'Como um novo processo nasce no Linux (fork/exec)?', '`fork` cria uma cópia do processo atual; `exec` troca o programa dessa cópia pelo novo. O shell faz isso a cada comando.'],
  // kernel
  ['kernel', 'Diferença entre kernel space e user space?', 'Kernel space roda com acesso total ao hardware; user space é onde ficam os programas, sem acesso direto. Um bug no kernel derruba a máquina; num programa, só o programa.'],
  ['kernel', 'O que é uma syscall?', 'A porta do user space para o kernel: o programa pede um serviço (open, read, write, fork) e o kernel executa por ele.'],
  ['kernel', 'O que quer dizer "no Linux, tudo é arquivo"?', 'Dispositivos (/dev), informação de processos (/proc), sockets e pipes são acessados pela mesma interface de arquivo: abrir, ler, escrever.'],
  ['kernel', 'Para que servem /etc, /var/log, /tmp e /home?', '/etc = configurações; /var/log = logs; /tmp = temporários (podem sumir no boot); /home = diretórios dos usuários.'],
  // env
  ['env', 'O que é a variável PATH?', 'Lista de diretórios, separados por `:`, onde o shell procura o executável quando você digita um comando.'],
  ['env', 'Por que se roda `./script.sh` e não só `script.sh`?', 'O diretório atual não está no PATH (por segurança). `./` diz o caminho explícito.'],
  ['env', 'Como saber qual binário roda quando você digita `python`?', '`which python` (ou `type python`) mostra o caminho encontrado no PATH.'],
  ['env', 'Diferença entre `VAR=x` e `export VAR=x`?', 'Sem export, a variável só existe no shell atual. Com export, ela é herdada pelos processos filhos que o shell iniciar.'],
  ['env', 'Como listar e ler variáveis de ambiente?', '`env` ou `printenv` listam todas; `echo $HOME` lê uma.'],
  ['env', 'Onde colocar um `export` para valer em todo terminal novo?', 'No `~/.bashrc` (bash) ou `~/.zshrc` (zsh). Para aplicar no terminal atual: `source ~/.bashrc`.'],
  ['env', 'Para que serve a primeira linha `#!/usr/bin/env bash` de um script?', 'É o shebang: diz qual interpretador roda o arquivo. O `env` acha o bash pelo PATH.'],
  ['env', 'Onde ler a documentação de um comando no próprio terminal?', '`man comando` abre o manual; `comando --help` dá o resumo.'],
]

export const LINUX: Card[] = CARDS.map(([topic, front, back]) => ({ src: 'linux', front, back, topic }))
