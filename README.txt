Bzden4ik Player — музыка с YouTube за баллы канала Twitch, прямо в OBS.

Скачать новую версию и пошаговую установку: https://github.com/Bzden4ik/Bzden4ikPlayer

Коротко:
1. Установи Node.js LTS: https://nodejs.org/ru/download
2. Держи все файлы из этого архива в одной постоянной папке, например C:\Bzden4ikPlayer
3. OBS -> Сервис -> Скрипты -> «+» -> obs-autostart.lua
4. OBS -> Док-панели -> Пользовательские док-панели браузера:
     Плеер   http://localhost:8000/redeem-player.html
5. Источник «Браузер» «Плеер — зрители»:
     http://localhost:8000/redeem-player.html?view=player
     1920 x 1080, галочка «Управлять звуком через OBS»
6. Источник «Браузер» «Плеер — мне»:
     http://localhost:8000/redeem-player.html?view=player&role=me
     галочка «Управлять звуком через OBS», в «Расширенных свойствах звука» —
     «Только мониторинг (без вывода)»
7. В панели: ⚙ -> «Подключить» (Twitch) -> «Создать награду».

Обновление: замени файлы в папке новыми. data.json (история и плейлисты) не удаляй.
