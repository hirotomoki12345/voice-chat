class ChatModule {
  constructor(serverUrl, onStatusUpdate) {
      this.serverUrl = serverUrl;
      this.socket = null;
      this.localStream = null;
      this.peerConnection = null;
      this.clientId = null;
      this.targetId = null; // 現在通話中のターゲットID
      this.onStatusUpdate = onStatusUpdate || console.log;
  }

  // 初期化してサーバーに接続
  async init() {
      return new Promise((resolve, reject) => {
          this.socket = new WebSocket(this.serverUrl);

          this.socket.onopen = () => {
              this.onStatusUpdate("WebSocket connected.");
          };

          this.socket.onmessage = async (event) => {
              const data = JSON.parse(event.data);
              switch (data.type) {
                  case "id":
                      this.clientId = data.id;
                      this.onStatusUpdate(`Client ID: ${this.clientId}`);
                      resolve(this.clientId); // 初期化時にIDを返す
                      break;
                  case "request":
                      this.handleIncomingRequest(data);
                      break;
                  case "response":
                      this.handleResponse(data);
                      break;
                  case "offer":
                  case "answer":
                  case "candidate":
                      this.handleWebRTCSignal(data);
                      break;
                  case "disconnect":
                      this.handleDisconnect(data);
                      break;
                  default:
                      console.error("Unknown message type:", data.type);
              }
          };

          this.socket.onerror = (error) => {
              this.onStatusUpdate(`WebSocket error: ${error}`);
              reject(error);
          };

          this.socket.onclose = () => {
              this.onStatusUpdate("WebSocket disconnected.");
          };
      });
  }

  // 通話リクエストを送信
  sendCallRequest(targetId) {
      if (!targetId) {
          throw new Error("Target ID is required.");
      }
      this.socket.send(JSON.stringify({ type: "request", targetId }));
      this.targetId = targetId; // ターゲットIDを保存
      this.onStatusUpdate(`Call request sent to: ${targetId}`);
  }

  // ローカルマイクを有効化
  async enableLocalStream() {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.onStatusUpdate("Local audio stream enabled.");
  }

  // 通話リクエストを受信した場合
  handleIncomingRequest(data) {
      const accept = confirm(`User ${data.from} is requesting a call. Accept?`);
      this.socket.send(JSON.stringify({ type: "response", targetId: data.from, accepted: accept }));
      if (accept) {
          this.onStatusUpdate(`Call accepted from: ${data.from}`);
          this.targetId = data.from;
          this.startCall(data.from, true); // 受信者として通話を開始
      } else {
          this.onStatusUpdate(`Call rejected from: ${data.from}`);
      }
  }

  // 通話リクエストへの応答を処理
  handleResponse(data) {
      if (data.accepted) {
          this.onStatusUpdate(`Call accepted by: ${data.from}`);
          this.targetId = data.from;
          this.startCall(data.from, false); // 呼び出し側として通話を開始
      } else {
          this.onStatusUpdate(`Call rejected by: ${data.from}`);
      }
  }

  // WebRTC接続をセットアップ
  async startCall(targetId, isReceiver) {
      this.peerConnection = new RTCPeerConnection();

      // ローカルストリームを接続に追加
      this.localStream.getTracks().forEach((track) => this.peerConnection.addTrack(track, this.localStream));

      // ICE候補を送信
      this.peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
              this.socket.send(JSON.stringify({ type: "candidate", candidate: event.candidate, targetId }));
          }
      };

      // リモートストリームを受信
      this.peerConnection.ontrack = (event) => {
          const remoteAudio = new Audio();
          remoteAudio.srcObject = event.streams[0];
          remoteAudio.play();
      };

      if (!isReceiver) {
          // オファーの作成と送信
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          this.socket.send(JSON.stringify({ type: "offer", offer, targetId }));
      }
  }

  // 通話を終了
  async endCall() {
      if (this.targetId) {
          // WebSocket接続が開いているか確認
          if (this.socket.readyState === WebSocket.OPEN) {
              this.socket.send(JSON.stringify({ type: "disconnect", targetId: this.targetId }));
              this.onStatusUpdate("Disconnect message sent to server.");
          } else {
              this.onStatusUpdate("WebSocket connection is not open.");
          }

          // WebRTC接続とローカルストリームをクリーンアップ
          this.cleanup();
          this.onStatusUpdate("Call ended.");
          this.targetId = null;
      } else {
          this.onStatusUpdate("No active call to end.");
      }
  }

  // 相手からの切断通知を処理
  handleDisconnect(data) {
      if (data.from === this.targetId) {
          this.onStatusUpdate(`Call disconnected by: ${data.from}`);
          this.cleanup();
          this.targetId = null;
      }
  }

  // リソースのクリーンアップ
  cleanup() {
      if (this.peerConnection) {
          this.peerConnection.close();
          this.peerConnection = null;
          console.log("Peer connection closed.");
      }
      if (this.localStream) {
          this.localStream.getTracks().forEach((track) => track.stop());
          this.localStream = null;
          console.log("Local stream stopped.");
      }
  }

  // WebRTCシグナリングメッセージの処理
  async handleWebRTCSignal(data) {
      switch (data.type) {
          case "offer":
              await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await this.peerConnection.createAnswer();
              await this.peerConnection.setLocalDescription(answer);
              this.socket.send(JSON.stringify({ type: "answer", answer, targetId: data.from }));
              break;
          case "answer":
              await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
              break;
          case "candidate":
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
              break;
      }
  }
}

// グローバルで利用可能なシンプルなインターフェース
window.chat = {
  instance: null,

  // 初期化
  async init(serverUrl, onStatusUpdate) {
      this.instance = new ChatModule(serverUrl, onStatusUpdate);
      return this.instance.init();
  },

  // 通話リクエストを送信
  call(targetId) {
      if (!this.instance) {
          throw new Error("Chat module is not initialized.");
      }
      this.instance.sendCallRequest(targetId);
  },

  // 通話を終了
  end() {
      if (!this.instance) {
          throw new Error("Chat module is not initialized.");
      }
      this.instance.endCall();
  },

  // ローカルストリームを有効化
  async enableAudio() {
      if (!this.instance) {
          throw new Error("Chat module is not initialized.");
      }
      await this.instance.enableLocalStream();
  }
};
