obs = obslua
local launch, save, slurp = nil, nil, nil
do
  local ok, ffi = pcall(require, "ffi")
  if ok and ffi.os == "Windows" then
    pcall(ffi.cdef, [[
      int MultiByteToWideChar(uint32_t cp, uint32_t flags, const char *s, int n, uint16_t *w, int wn);
      void *ShellExecuteW(void *hwnd, const uint16_t *op, const uint16_t *file, const uint16_t *params, const uint16_t *dir, int show);
      void *CreateFileW(const uint16_t *name, uint32_t access, uint32_t share, void *sec, uint32_t disp, uint32_t flags, void *tmpl);
      int WriteFile(void *h, const char *buf, uint32_t n, uint32_t *done, void *ov);
      int ReadFile(void *h, char *buf, uint32_t n, uint32_t *done, void *ov);
      int CloseHandle(void *h);
      int MoveFileExW(const uint16_t *from, const uint16_t *to, uint32_t flags);
    ]])
    local function W(s)
      local n = ffi.C.MultiByteToWideChar(65001, 0, s, -1, nil, 0)
      local b = ffi.new("uint16_t[?]", n)
      ffi.C.MultiByteToWideChar(65001, 0, s, -1, b, n)
      return b
    end
    local ok2, shell32 = pcall(ffi.load, "shell32")
    if ok2 then
      launch = function(file, params)
        local r = shell32.ShellExecuteW(nil, W("open"), W(file), W(params), nil, 0)
        return tonumber(ffi.cast("intptr_t", r)) > 32
      end
    end
    save = function(file, text)
      local h = ffi.C.CreateFileW(W(file .. ".tmp"), 0x40000000, 0, nil, 2, 0x80, nil)
      if tonumber(ffi.cast("intptr_t", h)) == -1 then return false end
      local done = ffi.new("uint32_t[1]")
      local wrote = ffi.C.WriteFile(h, text, #text, done, nil) ~= 0
      ffi.C.CloseHandle(h)
      return wrote and ffi.C.MoveFileExW(W(file .. ".tmp"), W(file), 1) ~= 0
    end
    slurp = function(file)
      local h = ffi.C.CreateFileW(W(file), 0x80000000, 7, nil, 3, 0x80, nil)
      if tonumber(ffi.cast("intptr_t", h)) == -1 then return nil end
      local buf, done = ffi.new("char[65536]"), ffi.new("uint32_t[1]")
      local ok3 = ffi.C.ReadFile(h, buf, 65536, done, nil) ~= 0
      ffi.C.CloseHandle(h)
      return ok3 and ffi.string(buf, done[0]) or nil
    end
  end
end
local function here()
  local dir = script_path():gsub("/", "\\")
  if dir:sub(-1) ~= "\\" then dir = dir .. "\\" end
  return dir
end
local function vbs(arg)
  local params = '"' .. here() .. 'start-server.vbs"' .. (arg and (" " .. arg) or "")
  if launch and launch("wscript.exe", params) then return end
  os.execute('start "" wscript ' .. params)
end
local S = nil                 -- настройки скрипта
local AL_NAMES, AL_CH = { "Оповещения", "Оповещения (все)" }, 30 -- канал вывода OBS: 1–6 заняты общими устройствами
local al = { ready = false, master = nil, names = {}, others = {}, seen = {}, M = nil, mute = nil, desk = "", me = false,
  ack = 0, sent = "", sentT = 0, n = 0 }
local function js(s)
  return '"' .. (tostring(s):gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end)) .. '"'
end
local function setting(src, key, kind)
  local st = obs.obs_source_get_settings(src)
  local v
  if kind == "bool" then v = obs.obs_data_get_bool(st, key) else v = obs.obs_data_get_string(st, key) end
  obs.obs_data_release(st)
  return v
end
local function reroute(src, on)
  local st = obs.obs_source_get_settings(src)
  obs.obs_data_set_bool(st, "reroute_audio", on)
  obs.obs_source_update(src, st)
  obs.obs_data_release(st)
end
local function priv(src, key, kind, val)
  local p = obs.obs_source_get_private_settings(src)
  local get = kind == "str" and obs.obs_data_get_string or kind == "num" and obs.obs_data_get_double or obs.obs_data_get_bool
  local cur = get(p, key)
  if val ~= nil then
    local set = kind == "str" and obs.obs_data_set_string or kind == "num" and obs.obs_data_set_double or obs.obs_data_set_bool
    set(p, key, val)
  end
  obs.obs_data_release(p)
  return cur
end
local function overlay(src) -- браузерный источник, кроме самого плеера
  return obs.obs_source_get_unversioned_id(src) == "browser_source" and not (setting(src, "url") or ""):find("redeem-player.html", 1, true)
end
local function each(fn) -- все источники; fn(src, id)
  local list = obs.obs_enum_sources()
  for _, s in ipairs(list or {}) do fn(s, obs.obs_source_get_unversioned_id(s)) end
  obs.source_list_release(list)
end
local function al_master(create, vol)
  local m = nil
  for _, name in ipairs(AL_NAMES) do
    local s = obs.obs_get_source_by_name(name)
    if s and priv(s, "bz_alerts") then m = s; break end
    if s then obs.obs_source_release(s)
    elseif create then
      local st = obs.obs_data_create()
      m = obs.obs_source_create("ffmpeg_source", name, st, nil)
      obs.obs_data_release(st)
      if m then priv(m, "bz_alerts", "bool", true); obs.obs_source_set_volume(m, vol or 1) end
      break
    end
  end
  if not m then return nil end
  priv(m, "mixer_pinned", "bool", true)
  obs.obs_set_output_source(AL_CH, m)
  return m
end
local function al_adopt(src)
  if priv(src, "bz_al", "str") ~= "" then return end
  local re, vol = setting(src, "reroute_audio", "bool"), obs.obs_source_get_volume(src)
  priv(src, "bz_al", "str", table.concat({ re and 1 or 0, obs.obs_source_get_monitoring_type(src), vol,
    obs.obs_source_muted(src) and 1 or 0, priv(src, "mixer_hidden") and 1 or 0 }, "\t"))
  priv(src, "bz_al_v", "num", vol)
  priv(src, "mixer_hidden", "bool", true)
  if not re then reroute(src, true) end
  obs.obs_source_set_monitoring_type(src, al.mute and obs.OBS_MONITORING_TYPE_MONITOR_ONLY or obs.OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT)
  local eff = (al.M or 1) * vol
  obs.obs_source_set_volume(src, eff)
  al.seen[obs.obs_source_get_name(src)] = eff
  obs.obs_source_set_muted(src, false)
end
local function al_release(src)
  local re, mon, vol, mu, hid = priv(src, "bz_al", "str"):match("^(%d)\t(%d+)\t([^\t]+)\t(%d)\t(%d)$")
  if not re then return end
  priv(src, "mixer_hidden", "bool", hid == "1")
  obs.obs_source_set_monitoring_type(src, tonumber(mon))
  obs.obs_source_set_volume(src, tonumber(vol) or 1)
  obs.obs_source_set_muted(src, mu == "1")
  if re == "0" then reroute(src, false) end
  priv(src, "bz_al", "str", "")
end
local function al_scan()
  local names, others, desk, me = {}, {}, "", false
  each(function(s, id)
    if id == "wasapi_output_capture" then
      if desk == "" and obs.obs_source_active(s) and not obs.obs_source_muted(s) and obs.obs_source_get_volume(s) > 0.001 then
        desk = obs.obs_source_get_name(s)
      end
    elseif id == "browser_source" then
      if not overlay(s) then
        if (setting(s, "url") or ""):find("role=me", 1, true) then me = true end
      elseif priv(s, "bz_al", "str") ~= "" then names[#names + 1] = obs.obs_source_get_name(s)
      elseif al.master and not priv(s, "bz_al_skip") then al_adopt(s); names[#names + 1] = obs.obs_source_get_name(s)
      else others[#others + 1] = obs.obs_source_get_name(s) end
    end
  end)
  table.sort(names); table.sort(others)
  al.names, al.others, al.desk, al.me = names, others, desk, me
end
local function al_each(fn)
  for _, n in ipairs(al.names) do
    local s = obs.obs_get_source_by_name(n)
    if s then fn(n, s); obs.obs_source_release(s) end
  end
end
local function al_sync()
  local m = al.master
  if not m then return end
  local M, mute = obs.obs_source_get_volume(m), obs.obs_source_muted(m)
  local newM, newMute = al.M == nil or math.abs(M - al.M) > 1e-6, mute ~= al.mute
  al.M, al.mute = M, mute
  al_each(function(n, s)
    local cur = obs.obs_source_get_volume(s)
    if newM then
      al.seen[n] = M * priv(s, "bz_al_v", "num")
      obs.obs_source_set_volume(s, al.seen[n])
    elseif al.seen[n] and math.abs(cur - al.seen[n]) > 1e-6 then
      if M > 1e-6 then priv(s, "bz_al_v", "num", cur / M) end
      al.seen[n] = cur
    elseif not al.seen[n] then
      al.seen[n] = cur -- переименовали или скрипт перезапущен: отсчитываем от того, что сейчас
    end
    if newMute then
      obs.obs_source_set_monitoring_type(s, mute and obs.OBS_MONITORING_TYPE_MONITOR_ONLY or obs.OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT)
    end
  end)
end
local function al_desk_off() -- выключить «Звук рабочего стола» (все такие захваты), «Вернуть как было» включит их обратно
  each(function(s, id)
    if id == "wasapi_output_capture" and not obs.obs_source_muted(s) then
      obs.obs_source_set_muted(s, true)
      priv(s, "bz_al_desk", "bool", true)
    end
  end)
end
local function al_collect()
  if not al.ready then return end
  if not al.master then
    local vol = nil
    each(function(s, id)
      if not vol and id == "wasapi_output_capture" and not obs.obs_source_muted(s) then vol = obs.obs_source_get_volume(s) end
    end)
    al.master = al_master(true, vol)
    if not al.master then return end
  end
  al_sync()
  al_scan()
  al_desk_off()
  al_scan()
end
local function al_revert()
  if not al.ready then return end
  each(function(s, id)
    if id == "browser_source" then al_release(s)
    elseif id == "wasapi_output_capture" and priv(s, "bz_al_desk") then
      obs.obs_source_set_muted(s, false)
      priv(s, "bz_al_desk", "bool", false)
    end
  end)
  local m = al.master or al_master(false)
  obs.obs_set_output_source(AL_CH, nil)
  if m then obs.obs_source_remove(m); obs.obs_source_release(m) end
  al.master, al.M, al.mute, al.seen = nil, nil, nil, {}
  al_scan()
end
local function al_pick(n, into)
  local s = obs.obs_get_source_by_name(n)
  if not s then return end
  if overlay(s) then
    if into then priv(s, "bz_al_skip", "bool", false); if al.master then al_adopt(s) end
    else al_release(s); priv(s, "bz_al_skip", "bool", true) end
  end
  obs.obs_source_release(s)
  al_scan()
end
local function al_apply(op, val, n)
  local x = math.max(0, math.min(1, tonumber(val) or 0))
  if op == "collect" then al_collect()
  elseif op == "revert" then al_revert()
  elseif op == "desk" then al_desk_off(); al_scan()
  elseif op == "drop" or op == "add" then al_pick(n, op == "add")
  elseif op == "M" and al.master then obs.obs_source_set_volume(al.master, x) -- остальное сделает al_sync
  elseif op == "mute" and al.master then obs.obs_source_set_muted(al.master, val == "1")
  elseif (op == "v" or op == "mu") and al.master then
    local s = obs.obs_get_source_by_name(n)
    if s then
      if priv(s, "bz_al", "str") ~= "" then -- только оверлеи под «Оповещениями»: другие источники панель не трогает
        if op == "mu" then obs.obs_source_set_muted(s, val == "1")
        else
          priv(s, "bz_al_v", "num", x)
          if al.M then al.seen[n] = al.M * x; obs.obs_source_set_volume(s, al.seen[n]) end
        end
      end
      obs.obs_source_release(s)
    end
  end
end
local function al_cmds()
  local text = slurp and slurp(here() .. "obs-alerts-cmd.txt")
  if not text then return end
  for id, op, val, n in text:gmatch("(%d+)\t(%a+)\t([^\t\n]*)\t([^\n]*)") do
    id = tonumber(id)
    if id > al.ack then
      al.ack = id
      if id / 1000 > os.time() - 15 then al_apply(op, val, n) end
    end
  end
end
local function al_report()
  if not save then return end
  local items, others = {}, {}
  al_each(function(n, s)
    items[#items + 1] = '{"n":' .. js(n) .. ',"v":' .. string.format("%.4f", priv(s, "bz_al_v", "num")) ..
      ',"mu":' .. tostring(obs.obs_source_muted(s)) .. ',"act":' .. tostring(obs.obs_source_active(s)) .. '}'
  end)
  for _, n in ipairs(al.others) do others[#others + 1] = js(n) end
  local body = '"on":' .. tostring(al.master ~= nil) .. ',"M":' .. string.format("%.4f", al.M or 1) .. ',"mute":' .. tostring(not not al.mute) ..
    ',"desk":' .. js(al.desk) .. ',"me":' .. tostring(al.me) .. ',"ack":' .. string.format("%.0f", al.ack) ..
    ',"items":[' .. table.concat(items, ",") .. '],"other":[' .. table.concat(others, ",") .. ']'
  if body ~= al.sent or os.time() - al.sentT >= 30 then
    if save(here() .. "obs-alerts.json", '{"t":' .. os.time() .. ',' .. body .. '}') then al.sent, al.sentT = body, os.time() end
  end
end
local function al_tick()
  if not al.ready then return end
  al_cmds()
  al.n = al.n + 1
  if al.n % 7 == 1 then al_scan() end -- раз в ~секунду
  al_sync()
  al_report()
end
local function al_ready()
  if al.ready then return end
  al.ready = true
  al.master = al_master(false)
  for n in (obs.obs_data_get_string(S, "mon_mine") or ""):gmatch("[^\n]+") do
    local s = obs.obs_get_source_by_name(n)
    if s then
      if obs.obs_source_get_monitoring_type(s) == obs.OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT then
        obs.obs_source_set_monitoring_type(s, obs.OBS_MONITORING_TYPE_NONE)
      end
      obs.obs_source_release(s)
    end
  end
  obs.obs_data_set_string(S, "mon_mine", "")
  al_scan()
end
local function al_unready() -- коллекцию сцен меняют: «Оповещения» прежней коллекции отпускаем
  if al.master then obs.obs_set_output_source(AL_CH, nil); obs.obs_source_release(al.master) end
  al.ready, al.master, al.names, al.others, al.seen, al.M, al.mute = false, nil, {}, {}, {}, nil, nil
end
function script_description()
  return "Запускает server.js (видео за баллы канала) в фоне вместе с OBS. Файл должен лежать рядом с server.js и start-server.vbs.\n\n" ..
    "Когда OBS закрывается, заказы за баллы закрываются, а при следующем запуске открываются снова " ..
    "(выключается в панели: Настройки → «Заказы вместе с OBS»).\n\n" ..
    "«Собрать звук оповещений»: оверлеи (все браузерные источники, кроме плеера) идут в эфир через OBS, а в микшере вместо них " ..
    "одна строка «Оповещения» — общий ползунок и кнопка. «Звук рабочего стола» выключается, поэтому копия плеера для тебя " ..
    "(«Мне») в эфир не попадает. Каждый оверлей по отдельности, убрать лишние и вернуть как было — в панели плеера, вкладка «Сейчас»."
end
function script_properties()
  local p = obs.obs_properties_create()
  obs.obs_properties_add_button(p, "al_collect", "Собрать звук оповещений в «Оповещения»", function() al_collect(); return true end)
  obs.obs_properties_add_button(p, "al_revert", "Вернуть звук оповещений как было", function() al_revert(); return true end)
  return p
end
local said = false
local function on_event(e)
  if e == obs.OBS_FRONTEND_EVENT_FINISHED_LOADING or e == obs.OBS_FRONTEND_EVENT_SCENE_COLLECTION_CHANGED then al_ready()
  elseif e == obs.OBS_FRONTEND_EVENT_SCENE_COLLECTION_CHANGING then al_unready() end
  if said then return end
  if e == obs.OBS_FRONTEND_EVENT_SCRIPTING_SHUTDOWN or e == obs.OBS_FRONTEND_EVENT_EXIT then
    said = true
    vbs("bye")
  end
end
function script_load(settings)
  S = settings
  obs.timer_add(al_tick, 150)
  local sc = obs.obs_frontend_get_current_scene()
  if sc then obs.obs_source_release(sc); al_ready() end
  vbs(nil)
  obs.obs_frontend_add_event_callback(on_event)
end
function script_unload()
  obs.timer_remove(al_tick)
  if al.master then obs.obs_set_output_source(AL_CH, nil); obs.obs_source_release(al.master); al.master = nil end
end
