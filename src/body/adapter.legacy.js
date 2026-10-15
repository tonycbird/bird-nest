/* Bird Nest adapter. Appended to the legacy Bird Fitness script and run in the same scope,
   so it can reach UI, VIEWS, ACT, Store and the logic functions without changing them.
   Everything the old app did still runs as-is; this only adds the links to Nest. */
(function () {
  var host = null;
  try { host = window.parent !== window && window.parent.__nestFit ? window.parent.__nestFit : null; } catch (e) { host = null; }

  /* ---- what the River needs: today's flow as blocks with steps ---- */
  function nestPlan(date) {
    date = date || today();
    var s = SET(), st = s.stretch, w = dayWorkout(date), out = [];
    if (w) {
      var W = workoutById(w), T = s.gymTime, est = estMinutes(w), wm = warmMinutes(), mach = warmMachine(w), wuS = s.warmup;
      var m = Store.m[monthKey(date)], warmDone = !!(m && m.warm[date]);
      var e1 = stretchEntry(date, 's1'), e2 = stretchEntry(date, 's2');
      var warm = [];
      if (wuS.walk) warm.push({ label: 'Walk', value: wuS.walk + ' min', done: warmDone });
      if (wuS.machine) warm.push({ label: mach.name, value: wuS.machine + ' min', done: warmDone });
      if (st.s1 > 0) warm.push({ label: 'Movement prep', value: st.s1 + ' min', done: !!(e1 && e1.full) });
      if (warm.length) out.push({ key: 'warm', icon: '🔥', title: 'Warm-up', start: T, minutes: wm + (st.s1 || 0), steps: warm });
      var sess = sessionOn(date, w);
      var lifts = sessionSlots(w, date).map(function (sl) {
        var ex = EX[sl.id], e = sess && sess.ex[sl.u], t = null;
        try { t = exTarget(sl, date, sess && sess.id); } catch (err) { t = null; }
        var load = t && t.w != null && !ex.time ? ' · ' + fmtW(t.w) + (ex.pair ? ' ea' : '') : '';
        return { label: ex.name, value: fmtScheme(sl) + load, done: !!(e && e.id === sl.id && e.done) };
      });
      out.push({ key: 'main', icon: '🏋', title: W.name, start: T + wm + (st.s1 || 0), minutes: est, steps: lifts, wid: w, done: !!(sess && sess.fin) });
      var p2 = stretchPlan(date, 's2');
      out.push({ key: 'cool', icon: '🧘', title: 'Cool-down', start: T + wm + (st.s1 || 0) + est, minutes: st.s2,
        steps: p2.items.map(function (it) { return { label: ST[it.id].name, value: it.dur + 's' + (ST[it.id].sides ? ' a side' : '') + (p2.rounds > 1 ? ' ×' + p2.rounds : ''), done: !!(e2 && e2.full) }; }) });
    } else {
      stretchKinds(date).forEach(function (k) {
        var p = stretchPlan(date, k.k), e = stretchEntry(date, k.k), full = !!(e && e.full);
        var steps = [];
        p.pre.forEach(function (it) { steps.push(it.warm ? { label: 'Easy cardio', value: Math.round(it.dur / 60) + ' min', done: full } : { label: ST[it.id].name, value: it.dur + 's', done: full }); });
        p.items.forEach(function (it) { steps.push({ label: ST[it.id].name, value: it.dur + 's' + (p.rounds > 1 ? ' ×' + p.rounds : ''), done: full }); });
        out.push({ key: k.k, icon: '🧘', title: k.title, start: null, minutes: k.min, steps: steps });
      });
    }
    return { date: date, workout: w ? workoutById(w).name : null, blocks: out };
  }

  /* ---- groceries: one list, in Head ---- */
  var _groc = groceryContent;
  groceryContent = function () {
    var html = _groc();
    if (!host) return html;
    return '<div class="card nest-groc"><div class="row between"><span><b>🛒 One list</b><small class="fine" style="display:block">Send what’s left to your Head groceries.</small></span>' +
      '<button class="btn-sm" data-a="nestGroc">🧠 Send</button></div></div>' + html;
  };
  ACT.nestGroc = function () {
    var mon = UI.gweek || mondayOf(today());
    var checks = Store.d.meals.grocery[mon] || {}, items = [];
    groceryList(mon).forEach(function (g) {
      if (g.sec === 'Spices & Sauces') return; // pantry staples: checked at home, not bought every week
      g.items.forEach(function (i) { if (!checks[i.k]) items.push({ name: i.name, amt: i.amt }); });
    });
    if (!items.length) { toast('Nothing left to send', 'info'); return; }
    host.addGroceries(items).then(function (n) {
      if (n == null) toast('Import Clearhead first — Head has no grocery list yet', 'info');
      else toast(n ? n + ' sent to Head groceries' : 'Already on your Head list', 'check');
    });
  };

  /* ---- Home Screen page: Nest is the installed app now ---- */
  VIEWS.sethome = function () {
    return navBar({ back: 'Settings' }) + '<div class="pad"><div class="dh"><h1 class="h1">Installed</h1><div class="sub">Bird Fitness lives inside Bird Nest now. Open Nest from your Home Screen — it works offline at the gym.</div></div></div>';
  };

  /* ---- tell Nest when something changes ---- */
  if (host) {
    var _save = Store.save;
    Store.save = function (key, auto) { _save.call(Store, key, auto); try { host.changed(key); } catch (e) {} };
    var _rt = renderTabbar;
    renderTabbar = function () { _rt(); try { host.tab(UI.tab, UI.stacks[UI.tab].length); } catch (e) {} };
    var _draw = Timer.draw;
    Timer.draw = function () { _draw.call(Timer); try { host.timer({ on: Timer.on, end: Timer.end, label: Timer.label, doneAt: Timer.doneAt }); } catch (e) {} };
  }

  window.__fit = {
    plan: nestPlan,
    tab: function () { return UI.tab; },
    goTab: function (t) { closeSheet(); goTab(t); },
    openWorkout: function (date, wid) { closeSheet(); UI.date = date; UI.seg.workout = 'today'; goTab('workout', { v: 'wdetail', w: wid, date: date }); },
    openStretch: function (date, k) { closeSheet(); ACT.openStretchTab({ d: date, k: k }); },
    openToday: function (date) { closeSheet(); UI.date = date || today(); UI.seg.workout = 'today'; UI.stacks.workout = [{ v: 'wroot' }]; UI.tab = 'workout'; render({ top: true }); },
    checkIn: function () { ACT.checkIn(); },
    refresh: function () { try { if (!Player.on) render(); Timer.draw(); } catch (e) {} },
    markWarm: function (date) { var m = Store.month(monthKey(date), true); if (!m.warm[date]) { m.warm[date] = true; Store.save('m:' + monthKey(date)); if (!Player.on) render(); } },
    timerAdd: function (s) { Timer.add(s); },
    timerStop: function () { Timer.stop(); },
    exportAll: function () { return Store.exportAll(); },
    // For parity tests: the same functions the old app used.
    fn: { plateMath: plateMath, roundLoad: roundLoad, exTarget: exTarget, warmupSets: warmupSets, prList: prList, rotationFor: rotationFor, plannedWorkout: plannedWorkout, estMinutes: estMinutes, Store: Store, EX: EX },
  };
  render({ top: true });
  try { if (host) host.ready(); } catch (e) {}
  // The first open on a new phone reads from Nest's database a moment after boot; say so when it lands.
  if (host) { var tries = 0; var iv = setInterval(function () { tries++; if (Store.online || tries > 40) { clearInterval(iv); try { host.changed('connect'); } catch (e) {} } }, 250); }
})();
