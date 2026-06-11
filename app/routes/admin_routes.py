"""
admin_routes — endpoints de administración (usuarios, permisos).

Protegidos por `requiere_rol('admin')`. Permiten:

    GET    /api/users                 — lista de usuarios + permisos
    POST   /api/users                 — crear usuario
    PUT    /api/users/<id>            — actualizar rol/permisos
    POST   /api/users/<id>/password   — admin cambia password de otro user
    DELETE /api/users/<id>            — eliminar usuario
    GET    /api/users/sections        — secciones disponibles para permisos
"""
import logging

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from app.permisos import requiere_rol
from app.auth import (
    listar_usuarios, crear_usuario, actualizar_usuario,
    cambiar_password_admin, eliminar_usuario, DEFAULT_SECTIONS,
)

logger = logging.getLogger(__name__)
admin_bp = Blueprint('admin', __name__)


@admin_bp.route('/api/users/sections', methods=['GET'])
@login_required
@requiere_rol('admin')
def users_sections():
    return jsonify({
        'sections': list(DEFAULT_SECTIONS),
        'roles':    ['admin', 'tecnico', 'operador', 'user'],
    })


@admin_bp.route('/api/users', methods=['GET'])
@login_required
@requiere_rol('admin')
def users_list():
    return jsonify({'users': listar_usuarios()})


@admin_bp.route('/api/users', methods=['POST'])
@login_required
@requiere_rol('admin')
def users_create():
    data = request.json or {}
    res = crear_usuario(
        username=data.get('username', ''),
        password=data.get('password', ''),
        role=data.get('role', 'user'),
        permisos=data.get('permisos') if isinstance(data.get('permisos'), list) else None,
    )
    if 'error' in res:
        return jsonify({'error': res['error']}), 400
    return jsonify({'status': 'ok', 'id': res['id']})


@admin_bp.route('/api/users/<user_id>', methods=['PUT'])
@login_required
@requiere_rol('admin')
def users_update(user_id):
    data = request.json or {}
    res = actualizar_usuario(user_id, data)
    if 'error' in res:
        return jsonify({'error': res['error']}), 400
    return jsonify({'status': 'ok'})


@admin_bp.route('/api/users/<user_id>/password', methods=['POST'])
@login_required
@requiere_rol('admin')
def users_set_password(user_id):
    data = request.json or {}
    res = cambiar_password_admin(user_id, data.get('new_password', ''))
    if 'error' in res:
        return jsonify({'error': res['error']}), 400
    return jsonify({'status': 'ok'})


@admin_bp.route('/api/users/<user_id>', methods=['DELETE'])
@login_required
@requiere_rol('admin')
def users_delete(user_id):
    if str(user_id) == str(current_user.id):
        return jsonify({'error': 'No puedes eliminarte a ti mismo'}), 400
    res = eliminar_usuario(user_id)
    if 'error' in res:
        return jsonify({'error': res['error']}), 400
    return jsonify({'status': 'ok'})
