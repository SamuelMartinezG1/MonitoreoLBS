from flask import Blueprint

# Definir Blueprints
dashboard_bp = Blueprint('dashboard', __name__)
calculator_bp = Blueprint('calculator', __name__)
api_bp = Blueprint('api', __name__)
management_bp = Blueprint('management', __name__)
documents_bp = Blueprint('documents', __name__)
guia_rapida_bp = Blueprint('guia_rapida', __name__)

# Importar las rutas para que se registren
from . import dashboard, calculator, api, management, documents, guia_rapida
