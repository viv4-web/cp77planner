-- cp77dump v9: cyberware dump for the CP77 build planner
-- Run in CET console: GetMod("cp77dump").dump()
local M = {}

local function s(f) local ok, v = pcall(f); if ok and v ~= nil then return v end; return nil end

local function esc(str)
  return (tostring(str):gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r',''))
end

local function enc(v)
  if v == nil then return "null" end
  local t = type(v)
  if t == "number" then return tostring(v) end
  if t == "boolean" then return v and "true" or "false" end
  if t == "table" then
    if #v > 0 or next(v) == nil then
      local a = {}
      for i = 1, #v do a[#a+1] = enc(v[i]) end
      return "[" .. table.concat(a, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys+1] = k end
    table.sort(keys)
    local a = {}
    for _, k in ipairs(keys) do a[#a+1] = '"' .. k .. '":' .. enc(v[k]) end
    return "{" .. table.concat(a, ",") .. "}"
  end
  return '"' .. esc(v) .. '"'
end

function CNameStr(c)
  local ok, v = pcall(function() return Game.NameToString(c) end)
  if ok and v and v ~= "" and v ~= "None" then return v end
  return tostring(c)
end

local function enumName(v)
  -- "gamedataQuality : Rare (9)" -> "Rare"
  if v == nil then return nil end
  local n = tostring(v):match(":%s*([%w_]+)")
  return n or tostring(v)
end

local function mods(list, group)
  local out = {}
  for _, m in ipairs(list or {}) do
    out[#out+1] = {
      stat  = s(function() return enumName(m:StatType():StatType()) end)
           or s(function() return TDBID.ToStringDEBUG(m:StatType():GetID()) end),
      op    = s(function() local t = tostring(m:ModifierType()); return t:match("%-%-%[%[%s*(%w+)") or t end),
      value = s(function() return m:Value() end),
      rec   = s(function() return TDBID.ToStringDEBUG(m:GetID()) end),
      group = group,
    }
  end
  return out
end

local function skipReason(id, itype, name, desc)
  if itype:find("StatsShard") then return "statsshard" end
  if name == nil or name == "" then return "noname" end
  if desc and desc:find("!OBSOLETE") then return "obsolete" end
  if id:find("_Tutorial_") then return "tutorial" end
  if id:find("_q%d%d%d") then return "quest" end
  return nil
end

function M.dump()
  local rows, skipped = {}, {}
  for _, r in ipairs(TweakDB:GetRecords("gamedataItem_Record")) do
    local itype = s(function() return tostring(r:ItemType():Type()) end) or ""
    if itype:find("Cyb") then
      local id   = s(function() return TDBID.ToStringDEBUG(r:GetID()) end) or "?"
      local name = s(function() return GetLocalizedTextByKey(r:DisplayName()) end)
      local desc = s(function() return GetLocalizedTextByKey(r:LocalizedDescription()) end)
      local why  = skipReason(id, itype, name, desc)
      if why then
        skipped[why] = (skipped[why] or 0) + 1
      else
        local sm = mods(s(function() return r:StatModifiers() end), nil)
        for _, g in ipairs(s(function() return r:StatModifierGroups() end) or {}) do
          local gid = s(function() return TDBID.ToStringDEBUG(g:GetID()) end)
          for _, m in ipairs(mods(s(function() return g:StatModifiers() end), gid)) do sm[#sm+1] = m end
        end
        rows[#rows+1] = {
          id      = id,
          name    = name,
          desc    = desc,
          itype   = enumName(itype),
          area    = enumName(s(function() return r:EquipArea():Type() end)),
          quality = enumName(s(function() return r:Quality():Type() end)),
          iconRec   = s(function() return TDBID.ToStringDEBUG(r:IconPath()) end),
          iconName  = s(function() return CNameStr(TweakDB:GetFlat(id .. ".iconPath")) end),
          iconAtlas = s(function() local u = TweakDB:GetRecord("UIIcon." .. CNameStr(TweakDB:GetFlat(id .. ".iconPath"))); return ResRef.ToString(u:AtlasResourcePath()) end)
                   or s(function() local u = TweakDB:GetRecord("UIIcon." .. CNameStr(TweakDB:GetFlat(id .. ".iconPath"))); return tostring(u:AtlasResourcePath()) end),
          iconPart  = s(function() local u = TweakDB:GetRecord("UIIcon." .. CNameStr(TweakDB:GetFlat(id .. ".iconPath"))); return CNameStr(u:AtlasPartName()) end),
          onEquip   = s(function()
                        local t = {}
                        for _, p in ipairs(r:OnEquip()) do
                          local pid = TDBID.ToStringDEBUG(p:GetID())
                          for _, m in ipairs(mods(s(function() return p:Stats() end), pid)) do t[#t+1] = m end
                        end
                        return t
                      end),
          tags    = s(function()
                      local t = {}
                      for _, x in ipairs(r:Tags()) do t[#t+1] = x.value or tostring(x) end
                      return t
                    end),
          stats   = sm,
        }
      end
    end
  end
  table.sort(rows, function(a, b) return a.id < b.id end)

  local lines = {}
  for i, row in ipairs(rows) do lines[i] = enc(row) end
  local f = io.open("cyberware_v9.json", "w")
  f:write("[\n" .. table.concat(lines, ",\n") .. "\n]\n")
  f:close()

  local sk = {}
  for k, v in pairs(skipped) do sk[#sk+1] = k .. "=" .. v end
  print("cp77dump v9: wrote " .. #rows .. " records; skipped " .. table.concat(sk, ", "))
end

-- Try candidate ways to get capacity cost: GetMod("cp77dump").cost("Items.AdvancedSandevistanC1MK1Plus")
function M.cost(id)
  local tests = {
    {"flat humanity",        function() return TweakDB:GetFlat(id .. ".humanity") end},
    {"flat capacity",        function() return TweakDB:GetFlat(id .. ".capacity") end},
    {"RPGManager.GetCyberwareCost", function() return RPGManager.GetCyberwareCost(TweakDBID.new(id)) end},
    {"EquipmentSystem.GetCyberwareCost", function() return EquipmentSystem.GetCyberwareCost(TweakDBID.new(id)) end},
    {"quality rec humanity", function() return TweakDB:GetFlat(CNameStr(TweakDB:GetFlat(id .. ".quality")) .. ".humanity") end},
    {"area rec",             function() return TDBID.ToStringDEBUG(TweakDB:GetFlat(id .. ".equipArea")) end},
  }
  for _, t in ipairs(tests) do
    local ok, v = pcall(t[2])
    print(t[1] .. ": " .. (ok and tostring(v) or "error"))
  end
end

-- Real capacity cost via the game's stat system (adds item, reads, removes).
-- GetMod("cp77dump").realcost("Items.AdvancedSandevistanC1MK1Plus")   one item, printed
-- GetMod("cp77dump").realcost()                                         all, to costs_v9.json
local COST_STATS = {"HumanityAllocated"}
local function costOf(id)
  local player = Game.GetPlayer()
  local ts = Game.GetTransactionSystem()
  local itemID = ItemID.FromTDBID(TweakDBID.new(id))
  ts:GiveItem(player, itemID, 1)
  local res = {}
  local data = ts:GetItemData(player, itemID)
  if data then
    for _, st in ipairs(COST_STATS) do
      local ok, v = pcall(function() return data:GetStatValueByType(gamedataStatType[st]) end)
      if ok and v and v ~= 0 then res[st] = v end
    end
  else
    res.error = "noitemdata"
  end
  ts:RemoveItem(player, itemID, 1)
  return res
end

function M.realcost(one)
  if one then
    local r = costOf(one)
    for k, v in pairs(r) do print(k .. " = " .. tostring(v)) end
    if next(r) == nil then print("no cost stat found") end
    return
  end
  local lines, n = {}, 0
  for _, r in ipairs(TweakDB:GetRecords("gamedataItem_Record")) do
    local itype = s(function() return tostring(r:ItemType():Type()) end) or ""
    if itype:find("Cyb") and not itype:find("StatsShard") then
      local id = TDBID.ToStringDEBUG(r:GetID())
      local ok, c = pcall(costOf, id)
      lines[#lines+1] = '"' .. esc(id) .. '":' .. enc(ok and c or {error = "fail"})
      n = n + 1
    end
  end
  table.sort(lines)
  local f = io.open("costs_v9.json", "w")
  f:write("{\n" .. table.concat(lines, ",\n") .. "\n}\n")
  f:close()
  print("cp77dump v9: costs for " .. n .. " items")
end

-- Print every non-zero stat on a real item: GetMod("cp77dump").allstats("Items.AdvancedSandevistanC1MK1Plus")
function M.allstats(id)
  local player = Game.GetPlayer()
  local ts = Game.GetTransactionSystem()
  local itemID = ItemID.FromTDBID(TweakDBID.new(id))
  ts:GiveItem(player, itemID, 1)
  local data = ts:GetItemData(player, itemID)
  if not data then print("noitemdata"); return end
  local max = EnumGetMax("gamedataStatType")
  local n = 0
  for i = 0, tonumber(max) do
    local name = EnumValueToString("gamedataStatType", i)
    if name and name ~= "" then
      local ok, v = pcall(function() return data:GetStatValueByType(gamedataStatType[name]) end)
      if ok and v and v ~= 0 then print(name .. " = " .. tostring(v)); n = n + 1 end
    end
  end
  ts:RemoveItem(player, itemID, 1)
  print("allstats: " .. n .. " non-zero")
end

-- Probe one item for capacity-cost fields: GetMod("cp77dump").probe("Items.AdvancedSandevistanC1MK1Plus")
function M.probe(id)
  for _, f in ipairs({"iconPath","icon","quality","humanity","humanityCost","capacityCost","cost","statModifierGroups","OnEquip","equipPrereqs","buyPrice","tier"}) do
    local ok, v = pcall(function() return TweakDB:GetFlat(id .. "." .. f) end)
    if ok and v ~= nil then
      local t = v
      if type(v) == "table" then local a = {} for _, x in ipairs(v) do a[#a+1] = TDBID.ToStringDEBUG(x) end t = table.concat(a, ", ") end
      print(f .. " = " .. tostring(t.value or t))
    end
  end
end

return M
