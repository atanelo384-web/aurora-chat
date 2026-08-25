from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os
import uuid
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = 'gigeon-secret-key-2024'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///gigeon.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    avatar = db.Column(db.Text, default='')
    status = db.Column(db.String(20), default='online')
    tag = db.Column(db.String(10), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Server(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    icon = db.Column(db.String(256), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Channel(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='text')  # text, voice
    server_id = db.Column(db.Integer, db.ForeignKey('server.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    channel_id = db.Column(db.Integer, db.ForeignKey('channel.id'), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_voice = db.Column(db.Boolean, default=False)
    voice_duration = db.Column(db.Integer, default=0)
    voice_data = db.Column(db.Text, default='')

class ServerMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    server_id = db.Column(db.Integer, db.ForeignKey('server.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

class CallParticipant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    call_id = db.Column(db.String(100), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    channel_id = db.Column(db.Integer, nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

def init_db():
    with app.app_context():
        db.create_all()
        # Create default server if not exists
        if Server.query.count() == 0:
            default_user = User(username='GigeonBot', email='bot@gigeon.com', 
                              password_hash=generate_password_hash('bot'), 
                              tag='#0000')
            db.session.add(default_user)
            db.session.commit()
            
            default_server = Server(name='Gigeon Community', owner_id=default_user.id)
            db.session.add(default_server)
            db.session.commit()
            
            channels = [
                Channel(name='general', type='text', server_id=default_server.id),
                Channel(name='voice-chat', type='voice', server_id=default_server.id),
                Channel(name='music', type='voice', server_id=default_server.id)
            ]
            for channel in channels:
                db.session.add(channel)
            db.session.commit()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email уже используется'}), 400
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Имя пользователя уже используется'}), 400
    
    tag = f'#{str(uuid.uuid4())[:4]}'
    user = User(
        username=data['username'],
        email=data['email'],
        password_hash=generate_password_hash(data['password']),
        tag=tag
    )
    db.session.add(user)
    db.session.commit()
    
    # Add to default server
    default_server = Server.query.first()
    member = ServerMember(server_id=default_server.id, user_id=user.id)
    db.session.add(member)
    db.session.commit()
    
    return jsonify({'success': True, 'user_id': user.id, 'tag': tag})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(email=data['email']).first()
    if user and check_password_hash(user.password_hash, data['password']):
        session['user_id'] = user.id
        return jsonify({
            'success': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'avatar': user.avatar,
                'status': user.status,
                'tag': user.tag
            }
        })
    return jsonify({'error': 'Неверный email или пароль'}), 401

@app.route('/api/user/<int:user_id>')
def get_user(user_id):
    user = User.query.get_or_404(user_id)
    return jsonify({
        'id': user.id,
        'username': user.username,
        'avatar': user.avatar,
        'status': user.status,
        'tag': user.tag
    })

@app.route('/api/servers')
def get_servers():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify([])
    members = ServerMember.query.filter_by(user_id=user_id).all()
    server_ids = [m.server_id for m in members]
    servers = Server.query.filter(Server.id.in_(server_ids)).all()
    return jsonify([{
        'id': s.id,
        'name': s.name,
        'icon': s.icon
    } for s in servers])

@app.route('/api/server/<int:server_id>/channels')
def get_channels(server_id):
    channels = Channel.query.filter_by(server_id=server_id).all()
    return jsonify([{
        'id': c.id,
        'name': c.name,
        'type': c.type
    } for c in channels])

@app.route('/api/channel/<int:channel_id>/messages')
def get_messages(channel_id):
    messages = Message.query.filter_by(channel_id=channel_id).order_by(Message.timestamp.desc()).limit(50).all()
    result = []
    for msg in reversed(messages):
        user = User.query.get(msg.user_id)
        result.append({
            'id': msg.id,
            'content': msg.content,
            'user_id': msg.user_id,
            'username': user.username if user else 'Unknown',
            'avatar': user.avatar if user else '',
            'tag': user.tag if user else '#0000',
            'timestamp': msg.timestamp.isoformat(),
            'is_voice': msg.is_voice,
            'voice_duration': msg.voice_duration,
            'voice_data': msg.voice_data
        })
    return jsonify(result)

@app.route('/api/user/<int:user_id>/update', methods=['POST'])
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.json
    if 'username' in data:
        user.username = data['username']
    if 'email' in data:
        user.email = data['email']
    if 'status' in data:
        user.status = data['status']
    if 'avatar' in data:
        user.avatar = data['avatar']
    if 'password' in data and data['password']:
        user.password_hash = generate_password_hash(data['password'])
    db.session.commit()
    return jsonify({'success': True})

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    user_id = session.get('user_id')
    if user_id:
        user = User.query.get(user_id)
        if user:
            user.status = 'offline'
            db.session.commit()
        emit('user_status', {'user_id': user_id, 'status': 'offline'}, broadcast=True)
    print(f'Client disconnected: {request.sid}')

@socketio.on('join_channel')
def handle_join_channel(data):
    channel_id = data['channel_id']
    room = f'channel_{channel_id}'
    join_room(room)
    emit('joined_channel', {'channel_id': channel_id, 'room': room})

@socketio.on('leave_channel')
def handle_leave_channel(data):
    channel_id = data['channel_id']
    room = f'channel_{channel_id}'
    leave_room(room)
    emit('left_channel', {'channel_id': channel_id})

@socketio.on('send_message')
def handle_send_message(data):
    user_id = session.get('user_id')
    if not user_id:
        return
    
    message = Message(
        content=data['content'],
        user_id=user_id,
        channel_id=data['channel_id'],
        is_voice=data.get('is_voice', False),
        voice_duration=data.get('voice_duration', 0),
        voice_data=data.get('voice_data', '')
    )
    db.session.add(message)
    db.session.commit()
    
    user = User.query.get(user_id)
    room = f'channel_{data["channel_id"]}'
    emit('new_message', {
        'id': message.id,
        'content': message.content,
        'user_id': user_id,
        'username': user.username,
        'avatar': user.avatar,
        'tag': user.tag,
        'timestamp': message.timestamp.isoformat(),
        'is_voice': message.is_voice,
        'voice_duration': message.voice_duration,
        'voice_data': message.voice_data
    }, room=room)

@socketio.on('start_call')
def handle_start_call(data):
    call_id = str(uuid.uuid4())
    channel_id = data['channel_id']
    user_id = session.get('user_id')
    
    participant = CallParticipant(
        call_id=call_id,
        user_id=user_id,
        channel_id=channel_id
    )
    db.session.add(participant)
    db.session.commit()
    
    room = f'call_{call_id}'
    join_room(room)
    
    emit('call_started', {
        'call_id': call_id,
        'channel_id': channel_id,
        'initiator_id': user_id,
        'type': data.get('call_type', 'voice')
    }, room=f'channel_{channel_id}')

@socketio.on('join_call')
def handle_join_call(data):
    call_id = data['call_id']
    user_id = session.get('user_id')
    channel_id = data['channel_id']
    
    participant = CallParticipant(
        call_id=call_id,
        user_id=user_id,
        channel_id=channel_id
    )
    db.session.add(participant)
    db.session.commit()
    
    room = f'call_{call_id}'
    join_room(room)
    
    emit('user_joined_call', {
        'call_id': call_id,
        'user_id': user_id
    }, room=room)

@socketio.on('leave_call')
def handle_leave_call(data):
    call_id = data['call_id']
    user_id = session.get('user_id')
    
    CallParticipant.query.filter_by(call_id=call_id, user_id=user_id).delete()
    db.session.commit()
    
    room = f'call_{call_id}'
    leave_room(room)
    
    emit('user_left_call', {
        'call_id': call_id,
        'user_id': user_id
    }, room=room)
    
    # Check if call is empty
    participants = CallParticipant.query.filter_by(call_id=call_id).all()
    if len(participants) == 0:
        emit('call_ended', {'call_id': call_id}, room=f'channel_{data["channel_id"]}')

@socketio.on('offer')
def handle_offer(data):
    emit('offer', data, room=f'call_{data["call_id"]}')

@socketio.on('answer')
def handle_answer(data):
    emit('answer', data, room=f'call_{data["call_id"]}')

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    emit('ice_candidate', data, room=f'call_{data["call_id"]}')

@socketio.on('call_signal')
def handle_call_signal(data):
    emit('call_signal', data, room=f'call_{data["target_room"]}')

@socketio.on('typing')
def handle_typing(data):
    user_id = session.get('user_id')
    user = User.query.get(user_id)
    room = f'channel_{data["channel_id"]}'
    emit('user_typing', {
        'user_id': user_id,
        'username': user.username if user else 'Unknown'
    }, room=room)

if __name__ == '__main__':
    init_db()
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
