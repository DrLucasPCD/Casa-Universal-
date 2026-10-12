import json
import os
import sys
import tempfile
import unittest

from mcp import Client, StdioServerParameters
from casa.store import ROOT


class MCPTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_startup_discovery_and_harmless_call(self):
        with tempfile.TemporaryDirectory() as directory:
            parameters=StdioServerParameters(command=sys.executable,args=['-m','casa.mcp_server'],cwd=str(ROOT),env={**os.environ,'CASA_DATA_DIR':directory})
            async with Client(parameters) as client:
                tools=await client.list_tools()
                names={tool.name for tool in tools.tools}
                self.assertEqual(names,{'listar_dispositivos','consultar_dispositivo','controlar_dispositivo','consultar_historico','buscar_dispositivos','consultar_casa','criar_controle_generico','aprender_botao_controle','consultar_catalogo_ir','testar_codigo_ir','configurar_botao_catalogo'})
                result=await client.call_tool('listar_dispositivos',{})
                self.assertFalse(result.is_error)
                text=json.dumps(result.structured_content)
                self.assertIn('Samsung',text)
                self.assertIn('not_configured',text)
                created=await client.call_tool('criar_controle_generico',{'type':'projector','name':'Projetor teste'})
                self.assertFalse(created.is_error)
                self.assertEqual(created.structured_content['actions'],[])
                self.assertIn('Foco +',json.dumps(created.structured_content,ensure_ascii=False))
                blocked=await client.call_tool('controlar_dispositivo',{'device_id':'tv','action':'power'})
                self.assertTrue(blocked.is_error)


if __name__=='__main__':unittest.main()
