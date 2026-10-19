# Meu mural

Um site local inspirado no Pinterest para organizar imagens e vídeos.

## Iniciar no Windows

1. Abra o PowerShell nesta pasta.
2. Execute `powershell -ExecutionPolicy Bypass -File .\start.ps1`.
3. Digite a senha quando o terminal pedir.
4. Abra [http://localhost:3000](http://localhost:3000) no navegador.
5. Clique em **Enviar** e entre com o nome `juneba` e a mesma senha.

O servidor precisa continuar aberto enquanto você usa o mural. Para encerrar, pressione `Ctrl+C` no PowerShell.

## Recursos

- Grade visual responsiva para fotos e vídeos, com busca por título ou nome do arquivo.
- Envio de vários arquivos, depois de validar nome e senha.
- Popup para abrir cada pin e botões de compartilhar, baixar e fechar.
- Arquivos e lista de pins salvos em `data/`, ao lado do servidor, permanecendo disponíveis após reiniciar.
- A senha é lida pelo PowerShell na inicialização e validada no servidor; ela não fica no código enviado ao navegador nem é gravada neste pacote.

Formatos aceitos: JPG, PNG, GIF, WEBP, AVIF, MP4, WEBM e MOV. Limite: 250 MB por arquivo.

## Publicar na internet

Esta versão está configurada para aceitar conexões somente do próprio computador (`127.0.0.1`). Para publicar em um serviço de hospedagem, configure `OWNER_USERNAME`, `OWNER_PASSWORD`, `HOST` e `PORT` como variáveis privadas do servidor e use HTTPS. Os arquivos enviados precisam de um volume persistente. Não coloque a senha em HTML ou JavaScript público.
