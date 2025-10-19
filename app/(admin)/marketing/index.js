// app/(admin)/marketing.js
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import { supabase, SUPABASE_ANON_KEY } from "../../../lib/supabase";

/* ---------- helpers ---------- */
const showErr = (title, err) => Alert.alert(title, typeof err === "string" ? err : err?.message || JSON.stringify(err));
const safeIdBody = (id) => ({ job_id: String(id) });
const preview = (s, n = 160) => (s ? (String(s).length > n ? String(s).slice(0, n) + "…" : String(s)) : "");
const pretty = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
const previewJson = (v, n = 220) => { const s = pretty(v); return s.length > n ? s.slice(0, n) + "…" : s; };

async function getAuthHeaders(extra = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = (data && data.session && data.session.access_token) ? data.session.access_token : SUPABASE_ANON_KEY;
    return Object.assign({ Authorization: "Bearer " + accessToken, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" }, extra);
  } catch {
    return Object.assign({ Authorization: "Bearer " + SUPABASE_ANON_KEY, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" }, extra);
  }
}

async function invoke(fn, body, okMsg) {
  try {
    const headers = await getAuthHeaders();
    const res = await supabase.functions.invoke(fn, { body: body || {}, headers });
    if (res.error) throw res.error;
    if (okMsg) Alert.alert(fn, okMsg);
    return res.data;
  } catch (e) {
    showErr(fn + " failed", e);
    return null;
  }
}

function getVideoUrlFromOutputs(outputs) {
  if (!outputs) return "";
  if (outputs.video_url) return String(outputs.video_url);
  try {
    if (outputs.video && typeof outputs.video === "string") return outputs.video;
    if (outputs.assets && outputs.assets.video) return String(outputs.assets.video);
    if (outputs.result_url) return String(outputs.result_url);
    if (outputs.output_url) return String(outputs.output_url);
  } catch {}
  return "";
}

/* --------- plain-English extractors --------- */
function getBasePrompt(outputs) {
  return outputs && outputs.video_prompt ? String(outputs.video_prompt) : "";
}
function getSentPrompt(outputs) {
  // Prefer webhook echo, fall back to worker’s stored prompt
  if (!outputs) return "";
  if (outputs.luma_prompt_final_webhook) return String(outputs.luma_prompt_final_webhook);
  if (outputs.luma_prompt_final) return String(outputs.luma_prompt_final);
  return "";
}
function getProvider(outputs) {
  if (!outputs) return {};
  return {
    state: outputs.last_provider_status ? String(outputs.last_provider_status) : "",
    id: outputs.last_provider_id ? String(outputs.last_provider_id) : "",
    at: outputs.last_provider_event_at ? String(outputs.last_provider_event_at) : "",
  };
}
function getLumaRequest(outputs) {
  if (!outputs) return {};
  // worker + webhook request mirrors
  return {
    worker: outputs.luma_request || null,
    webhook: outputs.luma_request_webhook || null
  };
}
function getChosenParams(outputs, jobSettings) {
  const req = getLumaRequest(outputs);
  const anyReq = req.webhook || req.worker || {};
  const model = anyReq.model || (jobSettings && jobSettings.model) || "ray-2";
  const duration = anyReq.duration || (jobSettings && jobSettings.duration) || (jobSettings && jobSettings.duration === 0 ? 0 : null);
  const aspect = anyReq.aspect_ratio || (jobSettings && jobSettings.aspect_ratio) || "9:16";
  return { model: String(model), duration: String(duration || "9s"), aspect: String(aspect) };
}
function getPlanSummary(outputs) {
  const p = outputs && outputs.luma_plan ? outputs.luma_plan : null;
  if (!p) return "No visual plan saved. Run the Visualizer step.";
  const bits = [];
  if (p.visual_style) bits.push("Style: " + String(p.visual_style));
  if (p.camera) bits.push("Camera: " + toList(p.camera));
  if (p.motion) bits.push("Motion: " + toList(p.motion));
  if (Array.isArray(p.shot_list) && p.shot_list.length) bits.push("Shots: " + String(p.shot_list.length) + " planned");
  if (p.music_mood) bits.push("Music: " + String(p.music_mood));
  return bits.length ? bits.join(" • ") : "Plan present but minimal.";
}
function toList(v) {
  if (!v) return "(none)";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function getErrorInfo(job) {
  const e = job && job.error ? String(job.error) : "";
  if (!e) return "";
  // Friendly mapping
  if (e.indexOf("timeout") >= 0) return "The provider took too long. It will be retried or you can trigger the worker again.";
  if (e.indexOf("create_failed_status_") === 0) return "Luma rejected the creation request. Check duration/model or your API key.";
  if (e.indexOf("auth_") === 0) return "Authentication issue with the provider. Check LUMA_API_KEY in Edge env.";
  if (e.indexOf("download:") === 0) return "We could not download the finished video. The link may have expired. Re-run the worker.";
  if (e.indexOf("upload:") === 0) return "The video downloaded but failed to upload to storage. Check bucket permissions.";
  if (e.indexOf("webhook_download_upload:") === 0) return "Webhook received completion but storing the video failed. Check storage policy and try again.";
  return e;
}
function getNextAction(job, providerState, sentPrompt, basePrompt) {
  // Suggest the most likely next action in plain English
  if (job.status === "approved" && !providerState.state) return "Start Luma Worker to generate a video.";
  if ((providerState.state === "queued" || providerState.state === "dreaming" || providerState.state === "running" || providerState.state === "processing") && !getVideoUrlFromOutputs(job.outputs)) {
    return "Wait for webhook or re-open the worker to continue polling.";
  }
  if (job.status === "error") return "Review the error message, then fix and re-run the Luma Worker.";
  if (!basePrompt) return "Run the Visualizer to create a visual prompt.";
  if (!sentPrompt) return "Run the Luma Worker; it will compose and send the final prompt.";
  if (job.status === "done") return "Video is ready. You can open it or publish via Ayrshare.";
  return "No action needed right now.";
}
async function copy(str, label) {
  if (!str) return;
  try {
    await Clipboard.setStringAsync(str);
    Alert.alert("Copied", label + " copied to clipboard");
  } catch (e) {
    Alert.alert("Copy failed", String(e));
  }
}

/* ---------- main UI ---------- */
export default function MarketingAdmin() {
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [offer, setOffer] = useState("");
  const [jobs, setJobs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Files state
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [prefix, setPrefix] = useState("generated/");
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState({});
  // Toggling JSON peeks
  const [openWorkerReq, setOpenWorkerReq] = useState({});
  const [openWebhookReq, setOpenWebhookReq] = useState({});
  const [openRawOutputs, setOpenRawOutputs] = useState({});

  const refreshJobs = useCallback(async function() {
    setLoading(true);
    const { data, error } = await supabase
      .from("marketing_jobs")
      .select("id,status,kind,created_at,updated_at,outputs,settings,error")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) showErr("Load jobs failed", error);
    setJobs(data || []);
    setLoading(false);
  }, []);

  const refreshNotifications = useCallback(async function() {
    setLoadingNotes(true);
    const { data, error } = await supabase
      .from("admin_notifications")
      .select("id,title,created_at,data,dismissed_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) showErr("Load notifications failed", error);
    setNotes(data || []);
    setLoadingNotes(false);
  }, []);

  async function createScriptJob() {
    if (!topic.trim()) return Alert.alert("Missing topic", "Please add a topic");
    try {
      const { data, error } = await supabase
        .from("marketing_jobs")
        .insert({ kind: "script", status: "pending", settings: { topic: topic, angle: angle, offer: offer } })
        .select("id")
        .single();
      if (error) throw error;
      const jobId = data.id;
      await invoke("marketing_scriptwriter", safeIdBody(jobId), "Scriptwriter started");
      await refreshJobs();
    } catch (e) {
      showErr("Create Script Job failed", e);
    }
  }

  async function runChain() {
    const job = jobs[0];
    if (!job) return Alert.alert("No recent job found");
    const id = job.id;
    Alert.alert("Pipeline", "Running full chain: Script → Visualizer → Guardrail → Luma");

    await invoke("marketing_scriptwriter", safeIdBody(id), "Script done");
    await invoke("marketing_visualizer", safeIdBody(id), "Visualizer done");
    await invoke("marketing_guardrail", safeIdBody(id), "Guardrail done");
    await invoke("marketing_luma_worker", safeIdBody(id), "Luma started");
    await refreshJobs();
  }

  // Files API wrappers (Edge function: marketing_storage_admin)
  async function listFiles() {
    setFilesLoading(true);
    try {
      const headers = await getAuthHeaders();
      const fnWithQuery = "marketing_storage_admin?action=list&prefix=" + encodeURIComponent(prefix) + "&limit=" + String(limit) + "&offset=" + String(offset);
      const res = await supabase.functions.invoke(fnWithQuery, { method: "GET", headers });
      if (res.error) throw res.error;
      const payload = res.data || {};
      setFiles(payload.files || []);
    } catch (e) {
      showErr("List files failed", e);
    }
    setFilesLoading(false);
  }

  async function copyUrl(u) {
    if (!u) return;
    try {
      await Clipboard.setStringAsync(u);
      Alert.alert("Copied", "Public URL copied to clipboard");
    } catch {
      Alert.alert("URL", u);
    }
  }
  async function openUrl(u) {
    if (!u) return;
    Linking.openURL(u).catch(function() { Alert.alert("Cannot open URL", u); });
  }
  function toggleSelected(p) {
    setSelected(function(prev){
      const next = Object.assign({}, prev);
      if (next[p]) delete next[p]; else next[p] = true;
      return next;
    });
  }
  async function deleteOne(path) {
    Alert.alert("Delete file?", path, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async function() {
        try {
          const headers = await getAuthHeaders();
          const res = await supabase.functions.invoke("marketing_storage_admin?action=delete", { method: "DELETE", headers, body: { paths: [path] } });
          if (res.error) throw res.error;
          await listFiles();
        } catch (e) { showErr("Delete failed", e); }
      } }
    ]);
  }
  async function deleteSelected() {
    const paths = Object.keys(selected);
    if (paths.length === 0) return Alert.alert("Nothing selected");
    Alert.alert("Delete selected files?", paths.length + " files", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async function() {
        try {
          const headers = await getAuthHeaders();
          const res = await supabase.functions.invoke("marketing_storage_admin?action=delete", { method: "DELETE", headers, body: { paths } });
          if (res.error) throw res.error;
          setSelected({});
          await listFiles();
        } catch (e) { showErr("Bulk delete failed", e); }
      } }
    ]);
  }

  // realtime
  useEffect(() => {
    refreshJobs();
    refreshNotifications();
    listFiles();

    const ch = supabase
      .channel("admin_marketing_live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "marketing_jobs" },
        function(payload) {
          const row = payload.new;
          if (row && row.status === "done") {
            Alert.alert("🎬 Video ready", "Job " + row.id + " finished rendering.");
            listFiles();
          }
          refreshJobs();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        function() {
          refreshNotifications();
          refreshJobs();
        }
      )
      .subscribe();

    return function cleanup() { supabase.removeChannel(ch); };
  }, [refreshJobs, refreshNotifications]);

  const counts = jobs.reduce(function(a, j) { a[j.status] = (a[j.status] || 0) + 1; return a; }, {});

  function openVideo(url) {
    if (!url) return;
    Linking.openURL(url).catch(function() { Alert.alert("Cannot open URL", url); });
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#f9fafb", padding: 16 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", marginBottom: 4 }}>Marketing</Text>
      <Text style={{ color: "#6b7280", marginBottom: 16 }}>Scripts, visualizer, guardrail, video, publish</Text>

      {/* Create Script Job */}
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>Create Script Job</Text>

        <TextInput placeholder="Topic (e.g. Fast quotes for plumbers)" value={topic} onChangeText={setTopic} style={{ borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, marginBottom: 8 }} />
        <TextInput placeholder="Angle (e.g. Save time and gain more work)" value={angle} onChangeText={setAngle} style={{ borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, marginBottom: 8 }} />
        <TextInput placeholder="Offer (optional)" value={offer} onChangeText={setOffer} style={{ borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, marginBottom: 12 }} />

        <TouchableOpacity onPress={createScriptJob} style={{ backgroundColor: "#2563eb", paddingVertical: 12, borderRadius: 10 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Run Scriptwriter</Text>
        </TouchableOpacity>
      </View>

      {/* Controls */}
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 12 }}>Pipeline Controls</Text>

        <TouchableOpacity onPress={function() { return jobs[0] ? invoke("marketing_scriptwriter", safeIdBody(jobs[0].id), "Scriptwriter done") : Alert.alert("No job found"); }} style={{ backgroundColor: "#3b82f6", paddingVertical: 12, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Run Scriptwriter Now</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={function() { return jobs[0] ? invoke("marketing_visualizer", safeIdBody(jobs[0].id), "Visualizer done") : Alert.alert("No job found"); }} style={{ backgroundColor: "#0ea5e9", paddingVertical: 12, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Run Visualizer Now</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={function() { return jobs[0] ? invoke("marketing_guardrail", safeIdBody(jobs[0].id), "Guardrail done") : Alert.alert("No job found"); }} style={{ backgroundColor: "#111827", paddingVertical: 12, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Run Guardrail Now</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={function() { return jobs[0] ? invoke("marketing_luma_worker", safeIdBody(jobs[0].id), "Luma started") : Alert.alert("No job found"); }} style={{ backgroundColor: "#10b981", paddingVertical: 12, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Run Luma Worker</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={function() { return jobs[0] ? invoke("marketing_ayrshare_publisher", safeIdBody(jobs[0].id), "Posted via Ayrshare") : Alert.alert("No job found"); }} style={{ backgroundColor: "#8b5cf6", paddingVertical: 12, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Publish via Ayrshare</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={runChain} style={{ backgroundColor: "#2563eb", paddingVertical: 12, borderRadius: 10, marginTop: 8 }}>
          <Text style={{ textAlign: "center", color: "white", fontWeight: "700" }}>▶ Chain: Script → Visualizer → Guardrail → Luma</Text>
        </TouchableOpacity>
      </View>

      {/* Counts */}
      <Text style={{ color: "#374151", marginBottom: 8 }}>
        Counts — pending: {counts.pending || 0} • running: {counts.running || 0} • script_ready: {counts.script_ready || 0} • needs_changes: {counts.needs_changes || 0} • approved: {counts.approved || 0} • done: {counts.done || 0}
      </Text>

      <TouchableOpacity onPress={refreshJobs} style={{ borderWidth: 1, borderColor: "#d1d5db", paddingVertical: 10, borderRadius: 10, alignItems: "center", marginBottom: 16 }}>
        {loading ? <ActivityIndicator color="#2563eb" /> : <Text style={{ fontWeight: "600" }}>Refresh Jobs</Text>}
      </TouchableOpacity>

      {/* Recent Jobs — PLAIN ENGLISH */}
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 12 }}>Recent Jobs (plain English)</Text>

        {jobs.map(function(j) {
          const url = getVideoUrlFromOutputs(j.outputs);
          const basePrompt = getBasePrompt(j.outputs);
          const sentPrompt = getSentPrompt(j.outputs);
          const prov = getProvider(j.outputs);
          const params = getChosenParams(j.outputs, j.settings);
          const planText = getPlanSummary(j.outputs);
          const err = getErrorInfo(j);
          const action = getNextAction(j, prov, sentPrompt, basePrompt);
          const workerReq = getLumaRequest(j.outputs).worker;
          const webhookReq = getLumaRequest(j.outputs).webhook;
          const isWrkOpen = !!openWorkerReq[j.id];
          const isWhOpen = !!openWebhookReq[j.id];
          const isOutOpen = !!openRawOutputs[j.id];

          return (
            <View key={j.id} style={{ borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingVertical: 14 }}>
              <Text style={{ fontWeight: "700" }}>{j.id}</Text>
              <Text style={{ color: "#6b7280", marginTop: 2 }}>Status: {j.status} • Kind: {j.kind}</Text>
              <Text style={{ color: "#6b7280", marginTop: 2 }}>Updated: {j.updated_at}</Text>

              <View style={{ marginTop: 8, backgroundColor: "#f9fafb", borderRadius: 10, padding: 10 }}>
                <Text style={{ color: "#111827", fontWeight: "600" }}>What we sent to Luma</Text>
                <Text style={{ color: "#4b5563", marginTop: 6 }}>
                  Final prompt: {sentPrompt ? preview(sentPrompt) : "(not recorded yet)"}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TouchableOpacity onPress={function(){ copy(sentPrompt, "Final Luma prompt"); }} style={{ backgroundColor: "#111827", paddingVertical: 8, borderRadius: 8, paddingHorizontal: 12 }}>
                    <Text style={{ color: "white", fontWeight: "600" }}>Copy Final Prompt</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ marginTop: 10, backgroundColor: "#f9fafb", borderRadius: 10, padding: 10 }}>
                <Text style={{ color: "#111827", fontWeight: "600" }}>Base visualizer prompt</Text>
                <Text style={{ color: "#4b5563", marginTop: 6 }}>
                  {basePrompt ? preview(basePrompt, 280) : "(none — run Visualizer)"}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TouchableOpacity onPress={function(){ copy(basePrompt, "Base visualizer prompt"); }} style={{ backgroundColor: "#374151", paddingVertical: 8, borderRadius: 8, paddingHorizontal: 12 }}>
                    <Text style={{ color: "white", fontWeight: "600" }}>Copy Base Prompt</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ marginTop: 10, backgroundColor: "#f9fafb", borderRadius: 10, padding: 10 }}>
                <Text style={{ color: "#111827", fontWeight: "600" }}>Render details</Text>
                <Text style={{ color: "#4b5563", marginTop: 6 }}>Model: {params.model} • Duration: {params.duration} • Aspect: {params.aspect}</Text>
                <Text style={{ color: "#4b5563", marginTop: 4 }}>
                  Provider status: {prov.state || "(unknown)"}{prov.id ? " • id: " + prov.id : ""}{prov.at ? " • last event: " + prov.at : ""}
                </Text>
                {j.outputs && j.outputs.luma_prompt_final_webhook && j.outputs.luma_prompt_final && (j.outputs.luma_prompt_final_webhook !== j.outputs.luma_prompt_final) ? (
                  <Text style={{ color: "#6b7280", marginTop: 4 }}>Note: webhook prompt differs from worker prompt</Text>
                ) : null}
                <Text style={{ color: "#111827", marginTop: 8, fontWeight: "600" }}>Plan summary</Text>
                <Text style={{ color: "#4b5563", marginTop: 4 }}>{planText}</Text>
              </View>

              {err ? (
                <View style={{ marginTop: 10, backgroundColor: "#fef2f2", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#fecaca" }}>
                  <Text style={{ color: "#991b1b", fontWeight: "700" }}>Problem</Text>
                  <Text style={{ color: "#7f1d1d", marginTop: 6 }}>{err}</Text>
                </View>
              ) : null}

              <View style={{ marginTop: 10, backgroundColor: "#ecfeff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#a5f3fc" }}>
                <Text style={{ color: "#164e63", fontWeight: "700" }}>Next action</Text>
                <Text style={{ color: "#164e63", marginTop: 6 }}>{action}</Text>
              </View>

              {/* Advanced peeks */}
              <View style={{ marginTop: 10, backgroundColor: "#f9fafb", borderRadius: 10, padding: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: "#111827", fontWeight: "600" }}>Luma request (worker)</Text>
                  <TouchableOpacity
                    onPress={function(){ setOpenWorkerReq(function(prev){ return Object.assign({}, prev, { [j.id]: !isWrkOpen }); }); }}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#e5e7eb" }}
                  >
                    <Text style={{ fontWeight: "600" }}>{isWrkOpen ? "Hide" : "Show"}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color: "#4b5563", marginTop: 6 }}>{workerReq ? previewJson(workerReq, 260) : "(no request saved)"}</Text>
                {isWrkOpen && workerReq ? (
                  <ScrollView horizontal style={{ marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 8 }}>
                    <Text style={{ fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontSize: 12, color: "#111827" }}>{pretty(workerReq)}</Text>
                  </ScrollView>
                ) : null}
              </View>

              <View style={{ marginTop: 10, backgroundColor: "#f9fafb", borderRadius: 10, padding: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: "#111827", fontWeight: "600" }}>Luma request (webhook)</Text>
                  <TouchableOpacity
                    onPress={function(){ setOpenWebhookReq(function(prev){ return Object.assign({}, prev, { [j.id]: !isWhOpen }); }); }}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#e5e7eb" }}
                  >
                    <Text style={{ fontWeight: "600" }}>{isWhOpen ? "Hide" : "Show"}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color: "#4b5563", marginTop: 6 }}>{webhookReq ? previewJson(webhookReq, 260) : "(no webhook request captured)"}</Text>
                {isWhOpen && webhookReq ? (
                  <ScrollView horizontal style={{ marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 8 }}>
                    <Text style={{ fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontSize: 12, color: "#111827" }}>{pretty(webhookReq)}</Text>
                  </ScrollView>
                ) : null}
              </View>

              {/* Open video */}
              {url ? (
                <TouchableOpacity onPress={function(){ openVideo(url); }} style={{ backgroundColor: "#10b981", paddingVertical: 10, borderRadius: 8, marginTop: 10 }}>
                  <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Open video</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Marketing Files */}
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 32, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 12 }}>Marketing Files</Text>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TextInput placeholder="prefix (e.g. generated/)" value={prefix} onChangeText={setPrefix} autoCapitalize="none" style={{ flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10 }} />
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          <TouchableOpacity onPress={listFiles} style={{ backgroundColor: "#2563eb", paddingVertical: 10, borderRadius: 10, flex: 1, alignItems: "center" }}>
            {filesLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "white", fontWeight: "600" }}>Refresh Files</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={deleteSelected} style={{ backgroundColor: "#ef4444", paddingVertical: 10, borderRadius: 10, flex: 1, alignItems: "center" }}>
            <Text style={{ color: "white", fontWeight: "600" }}>Delete Selected</Text>
          </TouchableOpacity>
        </View>

        {files.length === 0 ? (
          <Text style={{ color: "#6b7280" }}>No files found for prefix.</Text>
        ) : files.map(function(f) {
          const isSel = !!selected[f.path];
          return (
            <View key={f.path} style={{ borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingVertical: 12 }}>
              <TouchableOpacity onPress={function(){ toggleSelected(f.path); }} style={{ marginBottom: 6 }}>
                <Text style={{ fontWeight: "600" }}>{isSel ? "☑ " : "☐ "} {f.name}</Text>
              </TouchableOpacity>
              <Text style={{ color: "#6b7280" }}>{f.path}</Text>
              {f.last_modified ? <Text style={{ color: "#9ca3af" }}>updated: {String(f.last_modified)}</Text> : null}
              {typeof f.size === "number" ? <Text style={{ color: "#9ca3af" }}>size: {String(f.size)} bytes</Text> : null}

              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={function(){ openUrl(f.url); }} style={{ backgroundColor: "#10b981", paddingVertical: 8, borderRadius: 8, flex: 1, alignItems: "center" }}>
                  <Text style={{ color: "white", fontWeight: "600" }}>Open</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={function(){ copyUrl(f.url); }} style={{ backgroundColor: "#111827", paddingVertical: 8, borderRadius: 8, flex: 1, alignItems: "center" }}>
                  <Text style={{ color: "white", fontWeight: "600" }}>Copy URL</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={function(){ deleteOne(f.path); }} style={{ backgroundColor: "#ef4444", paddingVertical: 8, borderRadius: 8, flex: 1, alignItems: "center" }}>
                  <Text style={{ color: "white", fontWeight: "600" }}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* Admin Notifications */}
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 32, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 12 }}>Admin Notifications</Text>

        <TouchableOpacity onPress={refreshNotifications} style={{ borderWidth: 1, borderColor: "#d1d5db", paddingVertical: 10, borderRadius: 10, alignItems: "center", marginBottom: 12 }}>
          {loadingNotes ? <ActivityIndicator color="#2563eb" /> : <Text style={{ fontWeight: "600" }}>Refresh Notifications</Text>}
        </TouchableOpacity>

        {notes.length === 0 ? (
          <Text style={{ color: "#6b7280" }}>No notifications yet.</Text>
        ) : notes.map(function(n) {
          const data = n.data || {};
          const vurl = data.video_url || "";
          return (
            <View key={n.id} style={{ borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingVertical: 12 }}>
              <Text style={{ fontWeight: "600" }}>{n.title || "Notification"}</Text>
              <Text style={{ color: "#6b7280", marginTop: 2 }}>{n.created_at}</Text>
              {vurl ? (
                <TouchableOpacity onPress={function(){ openVideo(vurl); }} style={{ backgroundColor: "#111827", paddingVertical: 8, borderRadius: 8, marginTop: 8 }}>
                  <Text style={{ textAlign: "center", color: "white", fontWeight: "600" }}>Open video</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}