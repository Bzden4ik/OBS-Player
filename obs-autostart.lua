obs = obslua

local function vbs(arg)
  os.execute('start "" wscript "' .. script_path() .. 'start-server.vbs"' .. (arg and (" " .. arg) or ""))
end

function script_description()
  return "Запускает server.js (видео за баллы канала) в фоне вместе с OBS. Файл должен лежать рядом с server.js и start-server.vbs.\n\n" ..
    "Когда OBS закрывается, заказы за баллы закрываются, а при следующем запуске открываются снова " ..
    "(выключается в панели: Настройки → «Заказы вместе с OBS»)."
end

local function on_event(e)
  if e == obs.OBS_FRONTEND_EVENT_EXIT then vbs("bye") end
end

function script_load(settings)
  vbs(nil)
  obs.obs_frontend_add_event_callback(on_event)
end
