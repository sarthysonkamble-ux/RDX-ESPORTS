
const db = window.db;

let allRegistrations = [];
let tournamentMap = {};
let registrationSearch = "";
let registrationFilter = "all";

// =====================================
// HELPERS
// =====================================

function getElement(id) {
  return document.getElementById(id);
}

function safeText(value) {
  return String(value ?? "");
}

// =====================================
// ADMIN LOGIN
// =====================================

async function login() {
  const message = getElement("loginMessage");

  if (!db) {
    message.textContent = "Database connection missing.";
    return;
  }

  const email = getElement("email").value.trim();
  const password = getElement("password").value;

  if (!email || !password) {
    message.textContent = "Enter email and password.";
    return;
  }

  message.textContent = "Checking login...";

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (profileError || profile?.role !== "admin") {
      await db.auth.signOut();
      message.textContent = "Admin access denied.";
      return;
    }

    getElement("loginScreen").hidden = true;
    getElement("dashboard").hidden = false;

    await loadDashboard();

  } catch (error) {
    message.textContent = error.message;
  }
}

// =====================================
// CHECK SESSION
// =====================================

async function checkSession() {
  try {
    if (!db) return;

    const { data, error } = await db.auth.getSession();

    if (error) throw error;
    if (!data.session) return;

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", data.session.user.id)
      .single();

    if (!profileError && profile?.role === "admin") {
      getElement("loginScreen").hidden = true;
      getElement("dashboard").hidden = false;

      await loadDashboard();
    }

  } catch (error) {
    console.error(error);
  }
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
  await db.auth.signOut();
  location.reload();
}

// =====================================
// LOAD DASHBOARD
// =====================================

async function loadDashboard() {
  await Promise.allSettled([
    renderMatches(),
    renderRegistrations(),
    renderAnnouncements(),
    renderResultsPanel()
  ]);
}

// =====================================
// CREATE TOURNAMENT
// =====================================

async function addMatch() {
  const title = getElement("matchTitle").value.trim();
  const mode = getElement("matchMode").value.trim();
  const time = getElement("matchTime").value;

  if (!title || !mode || !time) {
    alert("Fill all tournament details.");
    return;
  }

  const { error } = await db.from("tournaments").insert({
    title,
    game_mode: mode,
    match_type: mode,
    total_slots: 48,
    filled_slots: 0,
    match_time: new Date(time).toISOString(),
    status: "open"
  });

  if (error) {
    alert(error.message);
    return;
  }

  alert("Tournament created!");

  getElement("matchTitle").value = "";
  getElement("matchMode").value = "";
  getElement("matchTime").value = "";

  await renderMatches();
  await loadResultTournaments();
}

// =====================================
// SHOW TOURNAMENTS
// =====================================

async function renderMatches() {
  const box = getElement("matchesList");
  if (!box) return;

  const { data, error } = await db
    .from("tournaments")
    .select("id,title,game_mode,match_time,status")
    .order("match_time", { ascending: true });

  if (error) {
    box.textContent = error.message;
    return;
  }

  box.replaceChildren();

  if (!data || data.length === 0) {
    box.textContent = "No tournaments created yet.";
    return;
  }

  data.forEach(match => {
    const card = document.createElement("div");
    card.className = "item";

    const heading = document.createElement("h3");
    heading.textContent = match.title;

    const mode = document.createElement("p");
    mode.textContent = "Mode: " + match.game_mode;

    const date = document.createElement("p");
    date.textContent = "Date: " +
      new Date(match.match_time).toLocaleString();

    const status = document.createElement("p");
    status.textContent = "Status: " + match.status;

    card.append(heading, mode, date, status);
    box.appendChild(card);
  });
}

// =====================================
// REGISTRATION MANAGEMENT
// =====================================

async function renderRegistrations() {
  const box = getElement("registrationsList");
  if (!box) return;

  box.textContent = "Loading registrations...";

  const { data: registrations, error } = await db
    .from("registrations")
    .select("id,tournament_id,user_id,game_name,status,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    box.textContent = error.message;
    return;
  }

  const { data: tournaments, error: tournamentError } = await db
    .from("tournaments")
    .select("id,title");

  if (tournamentError) {
    box.textContent = tournamentError.message;
    return;
  }

  tournamentMap = {};

  (tournaments || []).forEach(t => {
    tournamentMap[t.id] = t.title;
  });

  allRegistrations = registrations || [];

  buildRegistrationTools(box);
  displayRegistrations();
}

function buildRegistrationTools(box) {
  box.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "registration-toolbar";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search player name...";
  search.value = registrationSearch;
  search.className = "registration-search";

  search.addEventListener("input", function() {
    registrationSearch = this.value.toLowerCase().trim();
    displayRegistrations();
  });

  const filter = document.createElement("select");
  filter.className = "registration-filter";

  [
    ["all", "All Registrations"],
    ["pending", "Pending"],
    ["confirmed", "Confirmed"],
    ["rejected", "Rejected"]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    filter.appendChild(option);
  });

  filter.value = registrationFilter;

  filter.addEventListener("change", function() {
    registrationFilter = this.value;
    displayRegistrations();
  });

  const refresh = document.createElement("button");
  refresh.textContent = "REFRESH";
  refresh.className = "refresh-btn";
  refresh.onclick = renderRegistrations;

  toolbar.append(search, filter, refresh);

  const results = document.createElement("div");
  results.id = "registrationResults";

  box.append(toolbar, results);
}

function displayRegistrations() {
  const results = getElement("registrationResults");
  if (!results) return;

  results.replaceChildren();

  const filtered = allRegistrations.filter(player => {
    const name = (player.game_name || "").toLowerCase();

    const matchesSearch = name.includes(registrationSearch);

    const status = (player.status || "pending").toLowerCase();

    const matchesFilter =
      registrationFilter === "all" ||
      status === registrationFilter;

    return matchesSearch && matchesFilter;
  });

  const count = document.createElement("p");
  count.textContent =
    "Showing " + filtered.length +
    " of " + allRegistrations.length + " registrations";

  results.appendChild(count);

  if (!filtered.length) {
    results.append("No matching registrations found.");
    return;
  }

  filtered.forEach(player => {
    const card = document.createElement("div");
    card.className = "item registration-card";

    const heading = document.createElement("h3");
    heading.textContent = player.game_name || "Unknown Player";

    const tournament = document.createElement("p");
    tournament.textContent =
      "Tournament: " +
      (tournamentMap[player.tournament_id] || "Unknown");

    const uid = document.createElement("p");
    uid.textContent = "Account ID: " + player.user_id;

    const status = document.createElement("p");
    status.textContent =
      "Status: " + (player.status || "pending").toUpperCase();

    status.className =
      "registration-status status-" + (player.status || "pending");

    const approve = document.createElement("button");
    approve.textContent = "APPROVE";
    approve.disabled = player.status === "confirmed";
    approve.onclick = () =>
      updateRegistration(player.id, "confirmed");

    const reject = document.createElement("button");
    reject.textContent = "REJECT";
    reject.disabled = player.status === "rejected";
    reject.onclick = () =>
      updateRegistration(player.id, "rejected");

    card.append(heading, tournament, uid, status, approve, reject);
    results.appendChild(card);
  });
}

// =====================================
// APPROVE / REJECT
// =====================================

async function updateRegistration(id, newStatus) {
  if (!confirm("Change status to " + newStatus + "?")) return;

  const { error } = await db
    .from("registrations")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  alert("Registration updated!");
  await renderRegistrations();
}

// =====================================
// ANNOUNCEMENTS
// =====================================

async function addAnnouncement() {
  const title = getElement("announcementTitle").value.trim();
  const message = getElement("announcementMessage").value.trim();

  if (!title || !message) {
    alert("Enter title and message.");
    return;
  }

  const { error } = await db.from("announcements").insert({
    title,
    message
  });

  if (error) {
    alert(error.message);
    return;
  }

  alert("Announcement posted!");

  getElement("announcementTitle").value = "";
  getElement("announcementMessage").value = "";

  await renderAnnouncements();
}

async function renderAnnouncements() {
  const box = getElement("announcementsList");
  if (!box) return;

  const { data, error } = await db
    .from("announcements")
    .select("title,message")
    .order("created_at", { ascending: false });

  if (error) {
    box.textContent = error.message;
    return;
  }

  box.replaceChildren();

  if (!data || !data.length) {
    box.textContent = "No announcements yet.";
    return;
  }

  data.forEach(item => {
    const card = document.createElement("div");
    card.className = "item";

    const heading = document.createElement("h3");
    heading.textContent = item.title;

    const paragraph = document.createElement("p");
    paragraph.textContent = item.message;

    card.append(heading, paragraph);
    box.appendChild(card);
  });
}

// =====================================
// RESULTS MANAGER
// =====================================

async function renderResultsPanel() {
  const dashboard = getElement("dashboard");
  if (!dashboard) return;

  let section = getElement("resultsManager");

  if (!section) {
    section = document.createElement("section");
    section.id = "resultsManager";
    section.className = "card";

    section.innerHTML = `
      <h2>RESULTS MANAGER</h2>

      <label>Select Tournament</label>
      <select id="resultTournament">
        <option value="">Select Tournament</option>
      </select>

      <label>Player Name</label>
      <input id="resultPlayerName"
        type="text" placeholder="Enter player name">

      <label>Total Kills</label>
      <input id="resultKills"
        type="number" min="0" step="1" placeholder="Enter kills">

      <label>Position</label>
      <input id="resultPosition"
        type="number" min="1" step="1" placeholder="Enter position">

      <button type="button" id="saveResultButton">
        SAVE RESULT
      </button>

      <p id="resultMessage"></p>

      <hr>

      <h3>UPLOADED RESULTS</h3>

      <button type="button" id="refreshResultsButton">
        REFRESH RESULTS
      </button>

      <div id="resultsList">Loading results...</div>
    `;

    dashboard.appendChild(section);

    getElement("saveResultButton").onclick = addResult;
    getElement("refreshResultsButton").onclick = renderSavedResults;
  }

  await loadResultTournaments();
  await renderSavedResults();
}

// =====================================
// LOAD TOURNAMENT OPTIONS
// =====================================

async function loadResultTournaments() {
  const select = getElement("resultTournament");
  if (!select) return;

  const previousValue = select.value;

  select.innerHTML = '<option value="">Loading...</option>';

  const { data, error } = await db
    .from("tournaments")
    .select("id,title")
    .order("created_at", { ascending: false });

  if (error) {
    select.innerHTML = '<option value="">Error loading tournaments</option>';
    showResultMessage(error.message, "red");
    return;
  }

  select.innerHTML = '<option value="">Select Tournament</option>';

  (data || []).forEach(t => {
    const option = document.createElement("option");
    option.value = t.id;
    option.textContent = t.title;
    select.appendChild(option);
  });

  if ((data || []).some(t => t.id === previousValue)) {
    select.value = previousValue;
  }
}

// =====================================
// SAVE RESULT
// =====================================

async function addResult() {
  const tournamentId = getElement("resultTournament").value;
  const playerName = getElement("resultPlayerName").value.trim();
  const killsInput = getElement("resultKills").value;
  const positionInput = getElement("resultPosition").value;

  if (!tournamentId || !playerName ||
      killsInput === "" || positionInput === "") {
    showResultMessage("Please fill all fields.", "red");
    return;
  }

  const kills = Number(killsInput);
  const position = Number(positionInput);

  if (!Number.isInteger(kills) || kills < 0 ||
      !Number.isInteger(position) || position < 1) {
    showResultMessage("Enter valid kills and position.", "red");
    return;
  }

  const button = getElement("saveResultButton");
  button.disabled = true;
  button.textContent = "SAVING...";

  try {
    const { error } = await db
      .from("results")
      .insert({
        tournament_id: tournamentId,
        player_name: playerName,
        kills,
        position
      });

    if (error) throw error;

    showResultMessage("Result saved successfully!", "green");

    getElement("resultPlayerName").value = "";
    getElement("resultKills").value = "";
    getElement("resultPosition").value = "";

    await renderSavedResults();

  } catch (error) {
    showResultMessage(error.message, "red");
  } finally {
    button.disabled = false;
    button.textContent = "SAVE RESULT";
  }
}

// =====================================
// RESULT MESSAGE
// =====================================

function showResultMessage(message, color) {
  const box = getElement("resultMessage");
  if (!box) return;

  box.textContent = message;
  box.style.color = color;
}

// =====================================
// SHOW SAVED RESULTS
// =====================================

async function renderSavedResults() {
  const box = getElement("resultsList");
  if (!box) return;

  box.textContent = "Loading results...";

  try {
    const { data, error } = await db
      .from("results")
      .select("id,tournament_id,player_name,kills,position,created_at")
      .order("position", { ascending: true });

    if (error) throw error;

    const { data: tournaments, error: tournamentError } = await db
      .from("tournaments")
      .select("id,title");

    if (tournamentError) throw tournamentError;

    const names = {};

    (tournaments || []).forEach(t => {
      names[t.id] = t.title;
    });

    box.replaceChildren();

    if (!data || !data.length) {
      box.textContent = "No results uploaded yet.";
      return;
    }

    data.forEach(result => {
      const card = document.createElement("div");
      card.className = "item";

      const heading = document.createElement("h3");
      heading.textContent = result.player_name;

      const tournament = document.createElement("p");
      tournament.textContent =
        "Tournament: " + (names[result.tournament_id] || "Unknown");

      const kills = document.createElement("p");
      kills.textContent = "Kills: " + result.kills;

      const position = document.createElement("p");
      position.textContent = "Position: #" + result.position;

      card.append(heading, tournament, kills, position);
      box.appendChild(card);
    });

  } catch (error) {
    box.textContent = "Results error: " + error.message;
  }
}

// =====================================
// START
// =====================================

checkSession();
