obs = obslua
local launch = nil
do
  local ok, ffi = pcall(require, "ffi")
  if ok and ffi.os == "Windows" then
    pcall(ffi.cdef, [[
      int MultiByteToWideChar(uint32_t cp, uint32_t flags, const char *s, int n, uint16_t *w, int wn);
      void *ShellExecuteW(void *hwnd, const uint16_t *op, const uint16_t *file, const uint16_t *params, const uint16_t *dir, int show);
    ]])
    local ok2, shell32 = pcall(ffi.load, "shell32")
    if ok2 then
      local function W(s)
        local n = ffi.C.MultiByteToWideChar(65001, 0, s, -1, nil, 0)
        local b = ffi.new("uint16_t[?]", n)
        ffi.C.MultiByteToWideChar(65001, 0, s, -1, b, n)
        return b
      end
      launch = function(file, params)
        local r = shell32.ShellExecuteW(nil, W("open"), W(file), W(params), nil, 0)
        return tonumber(ffi.cast("intptr_t", r)) > 32
      end
    end
  end
end
local function vbs(arg)
  local dir = script_path():gsub("/", "\\")
  if dir:sub(-1) ~= "\\" then dir = dir .. "\\" end
  local params = '"' .. dir .. 'start-server.vbs"' .. (arg and (" " .. arg) or "")
  if launch and launch("wscript.exe", params) then return end
  os.execute('start "" wscript ' .. params)
end
function script_description()
  return "Запускает server.js (видео за баллы канала) в фоне вместе с OBS. Файл должен лежать рядом с server.js и start-server.vbs.\n\n" ..
    "Когда OBS закрывается, заказы за баллы закрываются, а при следующем запуске открываются снова " ..
    "(выключается в панели: Настройки → «Заказы вместе с OBS»)."
end
local said = false
local function on_event(e)
  if said then return end
  if e == obs.OBS_FRONTEND_EVENT_SCRIPTING_SHUTDOWN or e == obs.OBS_FRONTEND_EVENT_EXIT then
    said = true
    vbs("bye")
  end
end
function script_load(settings)
  vbs(nil)
  obs.obs_frontend_add_event_callback(on_event)
end
