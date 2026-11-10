#!/bin/sh
# lixeira (Linux): o rm do Claude manda para a lixeira do desktop (gio trash) em vez de apagar.
# Imita o rm no que importa: -f ignora inexistentes, diretório só com -r/-R/-d. Falha fechada:
# se a lixeira recusar, nada é apagado; a exceção é /tmp e /var/tmp (sem lixeira, temporários).
force=0; recursive=0; endopts=0; status=0; n=$#
while [ "$n" -gt 0 ]; do
  a=$1; shift; n=$((n - 1))
  if [ "$endopts" = 0 ]; then
    case $a in
      --) endopts=1; continue ;;
      --force) force=1; continue ;;
      --recursive|--dir) recursive=1; continue ;;
      --*) continue ;;
      -?*) case $a in *f*) force=1 ;; esac
           case $a in *[rRd]*) recursive=1 ;; esac
           continue ;;
    esac
  fi
  set -- "$@" "$a"
done
if ! command -v gio >/dev/null 2>&1; then
  echo "lixeira: gio não encontrado; nada foi apagado" >&2; exit 1
fi
for p do
  if [ ! -e "$p" ] && [ ! -L "$p" ]; then
    [ "$force" = 1 ] && continue
    echo "rm: não foi possível remover '$p': arquivo ou diretório inexistente" >&2; status=1; continue
  fi
  if [ -d "$p" ] && [ ! -L "$p" ] && [ "$recursive" = 0 ]; then
    echo "rm: não foi possível remover '$p': é um diretório" >&2; status=1; continue
  fi
  # gio has no "--": a relative name starting with - would be an option, so it goes as ./name.
  case $p in /*) q=$p ;; *) q=./$p ;; esac
  if gio trash "$q" 2>/dev/null; then continue; fi
  case $(realpath -m -- "$p") in
    /tmp/*|/var/tmp/*) command rm -rf -- "$p" || status=1 ;;
    *) echo "lixeira: '$p' não foi para a lixeira; nada foi apagado" >&2; status=1 ;;
  esac
done
exit "$status"
